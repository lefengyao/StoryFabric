import type { FileStore } from '../storage/fileStore'
import { parseFrontMatter, stringifyFrontMatter } from './frontMatter'

export const CURRENT_WORKSPACE_VERSION = 3

const V2_DIRS = [
  'characters/primary',
  'characters/secondary',
  'outline/total',
  'outline/chapters',
  'settings/background',
  'settings/other',
  'chapters/draft',
  'chapters/main',
  'events',
  'notes',
  'docs',
  '.storyfabric/sessions',
  '.storyfabric/trash'
]

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/[.\s]+$/, '').slice(0, 60) || '未命名'
}

function readVersion(raw: string | null): { version: number; name?: string; createdAt?: string } {
  if (!raw) return { version: 0 }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    return {
      version: typeof value.version === 'number' ? value.version : 1,
      name: typeof value.name === 'string' ? value.name : undefined,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined
    }
  } catch {
    return { version: 0 }
  }
}

async function copyIfMissing(store: FileStore, from: string, to: string): Promise<void> {
  if (!(await store.exists(from)) || (await store.exists(to))) return
  const raw = await store.readText(from)
  if (raw === null) return
  await store.writeText(to, raw)
  await store.remove(from)
}

async function migrateFlatCharacters(store: FileStore): Promise<void> {
  for (const file of await store.listFiles('characters', '.md')) {
    const source = `characters/${file}`
    const raw = await store.readText(source)
    let tier = 'secondary'
    let targetName = file
    if (raw) {
      try {
        const parsed = parseFrontMatter(raw)
        tier = parsed.data.tier === 'primary' ? 'primary' : 'secondary'
        const name = typeof parsed.data.name === 'string' ? parsed.data.name : file.replace(/\.md$/i, '')
        targetName = `${safeName(name)}.md`
      } catch {
        /* Keep the original file name for malformed legacy documents. */
      }
    }
    await copyIfMissing(store, source, `characters/${tier}/${targetName}`)
  }
}

async function migrateFlatOutlines(store: FileStore): Promise<void> {
  for (const file of await store.listFiles('outline', '.md')) {
    const source = `outline/${file}`
    const raw = await store.readText(source)
    let targetName = file
    if (raw) {
      try {
        const parsed = parseFrontMatter(raw)
        const title = typeof parsed.data.title === 'string' ? parsed.data.title : file.replace(/\.md$/i, '')
        targetName = `${safeName(title)}.md`
      } catch {
        /* Keep the original file name for malformed legacy documents. */
      }
    }
    await copyIfMissing(store, source, `outline/total/${targetName}`)
  }
}

async function migrateFlatChapters(store: FileStore): Promise<void> {
  const legacyFiles = await store.listFiles('chapters', '.md')
  for (const file of legacyFiles) {
    const source = `chapters/${file}`
    const raw = await store.readText(source)
    let targetName = file
    if (raw) {
      try {
        const parsed = parseFrontMatter(raw)
        const title = typeof parsed.data.title === 'string' ? parsed.data.title : file.replace(/\.md$/i, '')
        targetName = file.includes('-') ? file : `${safeName(title)}.md`
      } catch {
        /* Keep the original file name for malformed legacy documents. */
      }
    }
    await copyIfMissing(store, source, `chapters/main/vol_default/${targetName}`)
  }
}

async function ensureDefaultVolumes(store: FileStore): Promise<void> {
  if (!(await store.exists('chapters/volumes.json'))) {
    await store.writeText('chapters/volumes.json', JSON.stringify([{ id: 'vol_default', title: '第一卷', order: 1 }], null, 2))
  }
}

async function migrateEventMetadata(store: FileStore): Promise<void> {
  let firstVolumeId = 'vol_default'
  const volumesRaw = await store.readText('chapters/volumes.json')
  if (volumesRaw) {
    try {
      const volumes = JSON.parse(volumesRaw)
      if (Array.isArray(volumes) && typeof volumes[0]?.id === 'string' && volumes[0].id) {
        firstVolumeId = volumes[0].id
      }
    } catch {
      /* Malformed volume metadata falls back to the default volume id. */
    }
  }

  for (const file of await store.listFiles('events', '.md')) {
    const filePath = `events/${file}`
    const raw = await store.readText(filePath)
    if (!raw) continue
    try {
      const parsed = parseFrontMatter(raw)
      const nextData = {
        ...parsed.data,
        volumeId: typeof parsed.data.volumeId === 'string' && parsed.data.volumeId ? parsed.data.volumeId : firstVolumeId,
        branchIds: Array.isArray(parsed.data.branchIds) ? parsed.data.branchIds.filter((id): id is string => typeof id === 'string') : [],
        ...(typeof parsed.data.branchFromId === 'string' && parsed.data.branchFromId ? { branchFromId: parsed.data.branchFromId } : {})
      }
      await store.writeText(filePath, stringifyFrontMatter(parsed.content, nextData))
    } catch {
      /* Leave malformed event files untouched. */
    }
  }
}

/**
 * Idempotent v1 -> v2 workspace migration. The operation only touches known
 * StoryFabric paths and leaves user documents intact when run repeatedly.
 */
export async function migrateWorkspace(store: FileStore): Promise<void> {
  const meta = readVersion(await store.readText('storyfabric.json'))
  if (meta.version > CURRENT_WORKSPACE_VERSION) throw new Error(`工作区版本 ${meta.version} 高于当前支持版本 ${CURRENT_WORKSPACE_VERSION}`)
  for (const dir of V2_DIRS) await store.ensureDir(dir)
  if (meta.version < 2) {
    await migrateFlatCharacters(store)
    await migrateFlatOutlines(store)
    await migrateFlatChapters(store)
    await ensureDefaultVolumes(store)
  } else if (!(await store.exists('chapters/volumes.json'))) {
    await ensureDefaultVolumes(store)
  }
  if (meta.version < 3) {
    await migrateEventMetadata(store)
  }

  const next = {
    app: 'storyfabric',
    version: CURRENT_WORKSPACE_VERSION,
    name: meta.name ?? 'StoryFabric',
    createdAt: meta.createdAt ?? new Date().toISOString()
  }
  await store.writeText('storyfabric.json', JSON.stringify(next, null, 2))
}
