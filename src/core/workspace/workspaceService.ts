import type { FileStore } from '../storage/fileStore'
import type { ChapterBox, ChapterDoc, VolumeMeta, WorkspaceListItem, WorkspaceSummary } from '../../shared/types'
import { getChapterBody, listCharacters, listChapters, listEvents, listNotes, listOutline, listSettings, loadRelationships, saveChapter } from './entityStore'
import { CURRENT_WORKSPACE_VERSION, migrateWorkspace } from './migration'
import { cleanupWorkspace } from './housekeeping'
import { listTrash } from './trash'
import { buildProjectIndex } from '../retrieval/projectIndex'

export const WORKSPACE_MARKERS = ['storyfabric.json', 'characters', 'outline', 'events', 'chapters']

export async function validateWorkspace(store: FileStore): Promise<{ ok: boolean; reason?: string }> {
  if (await store.exists('storyfabric.json')) return { ok: true }
  let found = 0
  for (const marker of WORKSPACE_MARKERS.slice(1)) if (await store.exists(marker)) found++
  return found >= 3 ? { ok: true } : { ok: false, reason: '所选内容不是有效的 StoryFabric 工作区' }
}

export async function initializeWorkspace(store: FileStore, name: string): Promise<void> {
  await migrateWorkspace(store)
  await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: CURRENT_WORKSPACE_VERSION, name, createdAt: new Date().toISOString() }, null, 2))
  await store.writeText('relationships.json', '[]')
  if (!(await store.exists('outline/total/故事大纲.md'))) {
    await store.writeText('outline/total/故事大纲.md', ['---', 'id: out_core', 'title: 故事大纲', 'order: 1', 'kind: total', '---', '', '# 故事大纲', '', '在这里写下你的核心创意、主题与整体走向……', ''].join('\n'))
  }
}

async function countMarkdown(store: FileStore, dir: string): Promise<number> {
  const files = await store.listFiles(dir, '.md')
  const children = await store.listDirs(dir)
  let count = files.length
  for (const child of children) count += await countMarkdown(store, dir ? `${dir}/${child}` : child)
  return count
}

/** Read only picker metadata. This deliberately avoids migration, cleanup, indexing, and document bodies. */
export async function loadWorkspaceListItem(store: FileStore, fallbackName: string, path: string): Promise<WorkspaceListItem> {
  let name = fallbackName
  let version: number | undefined
  const raw = await store.readText('storyfabric.json')
  if (raw) {
    try {
      const meta = JSON.parse(raw) as { name?: unknown; version?: unknown }
      if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name
      if (typeof meta.version === 'number' && Number.isFinite(meta.version)) version = meta.version
    } catch { /* use fallback metadata */ }
  }
  let volumeCount = 0
  const volumesRaw = await store.readText('chapters/volumes.json')
  if (volumesRaw) {
    try {
      const value = JSON.parse(volumesRaw)
      if (Array.isArray(value)) volumeCount = value.filter((v) => typeof v?.id === 'string').length
    } catch { /* ignore malformed derived metadata */ }
  }
  let relationshipCount = 0
  const relationshipsRaw = await store.readText('relationships.json')
  if (relationshipsRaw) {
    try {
      const value = JSON.parse(relationshipsRaw)
      if (Array.isArray(value)) relationshipCount = value.length
    } catch { /* ignore malformed relationship metadata */ }
  }
  return { name, path, version, chapterCount: await countMarkdown(store, 'chapters'), volumeCount, relationshipCount }
}

export async function setWorkspaceName(store: FileStore, name: string): Promise<void> {
  const raw = await store.readText('storyfabric.json')
  if (!raw) throw new Error('工作区元数据缺失')
  try {
    const metadata = JSON.parse(raw) as Record<string, unknown>
    metadata.name = name
    await store.writeText('storyfabric.json', JSON.stringify(metadata, null, 2))
  } catch {
    throw new Error('工作区元数据无效')
  }
}

export async function listVolumes(store: FileStore): Promise<VolumeMeta[]> {
  const raw = await store.readText('chapters/volumes.json')
  if (!raw) return [{ id: 'vol_default', title: '第一卷', order: 1 }]
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((v): v is VolumeMeta => typeof v?.id === 'string' && typeof v?.title === 'string' && typeof v?.order === 'number').sort((a, b) => a.order - b.order)
      : []
  } catch {
    return []
  }
}

export async function saveVolume(store: FileStore, input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta> {
  const all = await listVolumes(store)
  const existing = input.id ? all.find((volume) => volume.id === input.id) : undefined
  const volume: VolumeMeta = existing
    ? { ...existing, ...input, id: existing.id, title: input.title?.trim() || existing.title, order: input.order ?? existing.order }
    : { id: input.id ?? `vol_${Date.now().toString(36)}`, title: input.title?.trim() || `第${all.length + 1}卷`, order: input.order ?? (all.length ? Math.max(...all.map((item) => item.order)) + 1 : 1) }
  if (all.some((item) => item.id !== volume.id && item.title === volume.title)) throw new Error(`卷名已存在：${volume.title}`)
  await store.ensureDir('chapters')
  await store.writeText('chapters/volumes.json', JSON.stringify([...all.filter((item) => item.id !== volume.id), volume].sort((a, b) => a.order - b.order), null, 2))
  return volume
}

export async function deleteVolume(store: FileStore, id: string): Promise<void> {
  const all = await listVolumes(store)
  if (!all.some((volume) => volume.id === id)) return
  const chapters = await listChapters(store)
  if (chapters.some((chapter) => chapter.box !== 'draft' && chapter.volumeId === id)) throw new Error('卷下仍有章节，请先移动章节后再删除卷')
  await store.writeText('chapters/volumes.json', JSON.stringify(all.filter((volume) => volume.id !== id), null, 2))
}

export async function moveChapter(store: FileStore, id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void> {
  const meta = (await listChapters(store)).find((chapter) => chapter.id === id)
  if (!meta) throw new Error(`未找到章节：${id}`)
  if (target.box === 'main') {
    const volumeId = target.volumeId ?? meta.volumeId ?? 'vol_default'
    const volume = (await listVolumes(store)).find((item) => item.id === volumeId)
    if (!volume) throw new Error(`未找到目标卷：${volumeId}`)
    const content = await getChapterBody(store, id)
    await saveChapter(store, { ...meta, box: 'main', volumeId, volume: volume.title, content: content ?? '' } satisfies Partial<ChapterDoc> & { id: string })
  } else {
    const content = await getChapterBody(store, id)
    await saveChapter(store, { ...meta, box: 'draft', content: content ?? '' } satisfies Partial<ChapterDoc> & { id: string })
  }
}

export async function loadSummary(store: FileStore, fallbackName: string, path: string): Promise<WorkspaceSummary> {
  await migrateWorkspace(store)
  try {
    await cleanupWorkspace(store)
  } catch {
    /* 临时文件清理失败不应阻断打开工作区。 */
  }
  try {
    await buildProjectIndex(store)
  } catch {
    /* 派生索引可在下次打开时重建，不阻断工作区读取。 */
  }
  const [characters, relationships, outline, events, chapters, settings, notes] = await Promise.all([listCharacters(store), loadRelationships(store), listOutline(store), listEvents(store), listChapters(store), listSettings(store), listNotes(store)])
  let name = fallbackName
  const raw = await store.readText('storyfabric.json')
  if (raw) {
    try {
      const meta = JSON.parse(raw)
      if (typeof meta?.name === 'string' && meta.name) name = meta.name
    } catch {
      /* fallback */
    }
  }
  let volumes: VolumeMeta[] = []
  const volumesRaw = await store.readText('chapters/volumes.json')
  if (volumesRaw) {
    try {
      const value = JSON.parse(volumesRaw)
      if (Array.isArray(value)) volumes = value.filter((v): v is VolumeMeta => typeof v?.id === 'string' && typeof v?.title === 'string' && typeof v?.order === 'number')
    } catch {
      volumes = []
    }
  }
  let trashCount = 0
  try { trashCount = (await listTrash(store)).length } catch { /* 损坏回收站索引不阻断工作区读取 */ }
  const volumeOrder = new Map(volumes.map((volume) => [volume.id, volume.order]))
  chapters.sort((a, b) => Number(a.box === 'draft') - Number(b.box === 'draft') || (volumeOrder.get(a.volumeId ?? 'vol_default') ?? Number.MAX_SAFE_INTEGER) - (volumeOrder.get(b.volumeId ?? 'vol_default') ?? Number.MAX_SAFE_INTEGER) || a.order - b.order)
  return { name, path, version: CURRENT_WORKSPACE_VERSION, volumes, characters, relationships, outline, events, chapters, settings, notes, trashCount }
}

export async function readGraphLayout(store: FileStore): Promise<Record<string, { x: number; y: number }>> {
  const raw = await store.readText('.storyfabric/layout.json')
  if (!raw) return {}
  try { return typeof JSON.parse(raw) === 'object' ? JSON.parse(raw) : {} } catch { return {} }
}

export async function writeGraphLayout(store: FileStore, layout: Record<string, { x: number; y: number }>): Promise<void> {
  await store.ensureDir('.storyfabric')
  await store.writeText('.storyfabric/layout.json', JSON.stringify(layout, null, 2))
}
