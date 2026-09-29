import type { FileStore } from '../storage/fileStore'
import { parseFrontMatter, stringifyFrontMatter } from './frontMatter'
import { boxForChapterStatus, normalizeChapterStatus } from '../../shared/chapterPlacement'

export const CURRENT_WORKSPACE_VERSION = 4

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
  'inspiration',
  '.storyfabric/sessions',
  '.storyfabric/trash',
  '.storyfabric/inspiration'
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

async function chapterFiles(store: FileStore, dir: string): Promise<string[]> {
  const files = (await store.listFiles(dir, '.md')).map((name) => `${dir}/${name}`)
  for (const child of await store.listDirs(dir)) files.push(...await chapterFiles(store, `${dir}/${child}`))
  return files
}

/** v4 makes chapter status authoritative for its physical box. Write first, then remove the old file. */
async function migrateChapterPlacement(store: FileStore): Promise<void> {
  const paths = [...await chapterFiles(store, 'chapters/draft'), ...await chapterFiles(store, 'chapters/main')]
  const volumesRaw = await store.readText('chapters/volumes.json')
  let volumeIds = new Set(['vol_default'])
  try {
    const volumes = JSON.parse(volumesRaw ?? '[]') as Array<{ id?: unknown }>
    if (Array.isArray(volumes)) volumeIds = new Set(volumes.filter((item) => typeof item?.id === 'string').map((item) => item.id as string))
  } catch { /* Use the default volume for malformed metadata. */ }
  if (!volumeIds.size) volumeIds.add('vol_default')
  const fallbackVolumeId = volumeIds.has('vol_default') ? 'vol_default' : [...volumeIds][0]
  for (const source of paths) {
    const raw = await store.readText(source)
    if (raw === null) continue
    let parsed
    try { parsed = parseFrontMatter(raw) } catch { continue }
    if (typeof parsed.data.id !== 'string' || !parsed.data.id) continue
    const currentBox = source.startsWith('chapters/draft/') ? 'draft' : 'main'
    const status = normalizeChapterStatus(parsed.data.status, currentBox)
    const targetBox = boxForChapterStatus(status)
    const volumeId = typeof parsed.data.volumeId === 'string' && /^[\w-]+$/.test(parsed.data.volumeId) && volumeIds.has(parsed.data.volumeId) ? parsed.data.volumeId : fallbackVolumeId
    const fileName = source.slice(source.lastIndexOf('/') + 1)
    const targetDir = targetBox === 'draft' ? 'chapters/draft' : `chapters/main/${volumeId}`
    let target = `${targetDir}/${fileName}`
    const next = stringifyFrontMatter(parsed.content, { ...parsed.data, box: targetBox, status, volumeId })
    if (target === source) {
      if (next !== raw) await store.writeText(source, next)
      continue
    }
    await store.ensureDir(targetDir)
    if (await store.exists(target)) {
      const existing = await store.readText(target)
      if (existing === next) { await store.removeFile(source); continue }
      if (existing && parseFrontMatter(existing).data.id === parsed.data.id) throw new Error(`章节迁移冲突：${source} 与 ${target} 具有相同 id 但内容不同，请保留文件并检查`)
      const stem = fileName.replace(/\.md$/i, '')
      const safeId = parsed.data.id.replace(/[^a-zA-Z0-9_-]/g, '_')
      let index = 0
      do {
        target = `${targetDir}/${stem}_${safeId}${index ? `_${index}` : ''}.md`
        index++
      } while (await store.exists(target))
    }
    await store.writeText(target, next)
    await store.removeFile(source)
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
  if (meta.version < 4) {
    await migrateChapterPlacement(store)
  }

  const next = {
    app: 'storyfabric',
    version: CURRENT_WORKSPACE_VERSION,
    name: meta.name ?? 'StoryFabric',
    createdAt: meta.createdAt ?? new Date().toISOString()
  }
  await store.writeText('storyfabric.json', JSON.stringify(next, null, 2))
}
