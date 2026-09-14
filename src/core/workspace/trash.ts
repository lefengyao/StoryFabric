import type { EntityKind, Relationship, TrashEntry } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { normalizeRelativePath } from '../storage/fileStore'
import { parseFrontMatter, stringifyFrontMatter } from './frontMatter'
import { commitTextChanges, type JournalTextChange } from './mutationJournal'
import { buildEventGraph } from './eventGraph'

const INDEX_PATH = '.storyfabric/trash/index.json'
const TRASH_KINDS = new Set<EntityKind>(['character', 'outline', 'event', 'chapter', 'setting', 'note'])
const ORIGINAL_ROOTS = new Set(['characters', 'outline', 'settings', 'events', 'chapters', 'notes'])

function trashPath(entry: Pick<TrashEntry, 'kind' | 'id' | 'trashPath'>): string {
  return entry.trashPath ?? `.storyfabric/trash/${entry.kind}/${entry.id}.md`
}

function isSafeOriginalPath(path: string): boolean {
  try {
    const normalized = normalizeRelativePath(path)
    return normalized === path.replaceAll('\\', '/') && ORIGINAL_ROOTS.has(normalized.split('/')[0])
  } catch {
    return false
  }
}

function isSafeTrashPath(path: string): boolean {
  try {
    const normalized = normalizeRelativePath(path)
    return normalized === path.replaceAll('\\', '/') && normalized.startsWith('.storyfabric/trash/') && normalized.length > '.storyfabric/trash/'.length
  } catch {
    return false
  }
}

function isSafeEntry(entry: TrashEntry): boolean {
  if (!TRASH_KINDS.has(entry.kind) || !entry.id || /[\\/]/.test(entry.id)) return false
  if (!isSafeOriginalPath(entry.originalPath)) return false
  return isSafeTrashPath(entry.trashPath ?? trashPath(entry))
}

async function readIndex(store: FileStore): Promise<TrashEntry[]> {
  const raw = await store.readText(INDEX_PATH)
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is TrashEntry => {
      return Boolean(entry && typeof entry.id === 'string' && typeof entry.kind === 'string' && typeof entry.originalPath === 'string' && typeof entry.deletedAt === 'number' && typeof entry.title === 'string' && isSafeEntry(entry as TrashEntry))
    })
  } catch {
    return []
  }
}

async function writeIndex(store: FileStore, entries: TrashEntry[]): Promise<void> {
  await store.ensureDir('.storyfabric/trash')
  await store.writeText(INDEX_PATH, JSON.stringify(entries, null, 2))
}

async function restoreRelatedRelationships(store: FileStore, relationships: Relationship[] | undefined): Promise<void> {
  if (!relationships?.length) return
  let current: Relationship[] = []
  const raw = await store.readText('relationships.json')
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) current = parsed as Relationship[]
    } catch {
      current = []
    }
  }
  const ids = new Set(current.map((item) => item.id))
  const merged = [...current, ...relationships.filter((item) => typeof item?.id === 'string' && !ids.has(item.id))]
  await store.writeText('relationships.json', JSON.stringify(merged, null, 2))
}

async function listMarkdown(store: FileStore, dir: string): Promise<string[]> {
  const files = (await store.listFiles(dir, '.md')).map((name) => `${dir}/${name}`)
  for (const child of await store.listDirs(dir)) files.push(...await listMarkdown(store, `${dir}/${child}`))
  return files
}

function connectionFields(data: Record<string, unknown>) {
  return {
    prevIds: Array.isArray(data.prevIds) ? data.prevIds.filter((id): id is string => typeof id === 'string') : [],
    nextIds: Array.isArray(data.nextIds) ? data.nextIds.filter((id): id is string => typeof id === 'string') : [],
    branchIds: Array.isArray(data.branchIds) ? data.branchIds.filter((id): id is string => typeof id === 'string') : [],
    branchFromId: typeof data.branchFromId === 'string' && data.branchFromId ? data.branchFromId : undefined
  }
}

async function restoreEventGraph(store: FileStore, entry: TrashEntry): Promise<void> {
  const snapshot = entry.eventConnections
  if (!snapshot) throw new Error('RESTORE_REQUIRES_PLACEMENT：旧回收站事件没有连接快照，请显式指定恢复位置')
  const files = await listMarkdown(store, 'events')
  const records = new Map<string, { path: string; data: Record<string, unknown>; content: string; raw: string }>()
  for (const path of files) {
    const raw = await store.readText(path)
    if (raw === null) continue
    const parsed = parseFrontMatter(raw)
    if (typeof parsed.data.id === 'string') records.set(parsed.data.id, { path, data: parsed.data, content: parsed.content.replace(/^\n+/, ''), raw })
  }
  for (const neighbor of snapshot.neighbors) {
    const current = records.get(neighbor.id)
    if (!current) throw new Error(`RESTORE_CONFLICT：邻居事件不存在：${neighbor.id}`)
    const fields = connectionFields(current.data)
    if (JSON.stringify(fields) !== JSON.stringify(neighbor.after)) throw new Error(`RESTORE_CONFLICT：邻居事件已有新编辑：${neighbor.id}`)
  }

  const changes: JournalTextChange[] = snapshot.neighbors.map((neighbor) => {
    const current = records.get(neighbor.id)!
    return {
      path: current.path,
      beforeText: current.raw,
      afterText: stringifyFrontMatter(current.content, { ...current.data, ...neighbor.before })
    }
  })
  const transaction = await commitTextChanges(store, `restore-event-${entry.id}-${Date.now()}`, changes, () => store.move(trashPath(entry), entry.originalPath))
  if (!transaction.ok) throw new Error(transaction.text)
}

export type EventRestorePlacement =
  | { kind: 'mainline-tail' }
  | { kind: 'after'; previousId: string; branchFromId?: string }

async function restoreLegacyEventWithPlacement(store: FileStore, entry: TrashEntry, placement: EventRestorePlacement): Promise<void> {
  const files = await listMarkdown(store, 'events')
  const records = []
  for (const path of files) {
    const raw = await store.readText(path)
    if (raw === null) continue
    const parsed = parseFrontMatter(raw)
    if (typeof parsed.data.id === 'string') {
      records.push({
        id: parsed.data.id,
        path,
        raw,
        data: parsed.data,
        content: parsed.content.replace(/^\n+/, ''),
        prevIds: Array.isArray(parsed.data.prevIds) ? parsed.data.prevIds.filter((id): id is string => typeof id === 'string') : [],
        nextIds: Array.isArray(parsed.data.nextIds) ? parsed.data.nextIds.filter((id): id is string => typeof id === 'string') : [],
        branchIds: Array.isArray(parsed.data.branchIds) ? parsed.data.branchIds.filter((id): id is string => typeof id === 'string') : [],
        branchFromId: typeof parsed.data.branchFromId === 'string' ? parsed.data.branchFromId : undefined
      })
    }
  }
  const graphEvents = records.map((record) => ({
    id: record.id,
    title: typeof record.data.title === 'string' ? record.data.title : record.id,
    volumeId: typeof record.data.volumeId === 'string' ? record.data.volumeId : 'vol_default',
    storyTime: '',
    order: typeof record.data.order === 'number' ? record.data.order : 0,
    location: '',
    tags: [],
    characterIds: [],
    prevIds: record.prevIds,
    nextIds: record.nextIds,
    branchIds: record.branchIds,
    branchFromId: record.branchFromId,
    content: record.content
  }))
  const previousId = placement.kind === 'mainline-tail'
    ? buildEventGraph(graphEvents).mainlineIds.at(-1)
    : placement.previousId
  if (!previousId || !records.some((record) => record.id === previousId)) throw new Error(`RESTORE_CONFLICT：指定前驱事件不存在：${previousId ?? ''}`)
  const branchFromId = placement.kind === 'after' ? placement.branchFromId : undefined
  if (branchFromId && !records.some((record) => record.id === branchFromId)) throw new Error(`RESTORE_CONFLICT：分支父事件不存在：${branchFromId}`)

  const targetRaw = await store.readText(trashPath(entry))
  if (targetRaw === null) throw new Error(`回收站文件不存在：${trashPath(entry)}`)
  const target = parseFrontMatter(targetRaw)
  if (typeof target.data.id !== 'string') throw new Error('回收站事件格式无效')
  const targetAfter = stringifyFrontMatter(target.content.replace(/^\n+/, ''), {
    ...target.data,
    prevIds: [previousId],
    nextIds: [],
    branchIds: [],
    ...(branchFromId ? { branchFromId } : {})
  })
  const previous = records.find((record) => record.id === previousId)!
  const changes: JournalTextChange[] = [{
    path: previous.path,
    beforeText: previous.raw,
    afterText: stringifyFrontMatter(previous.content, {
      ...previous.data,
      nextIds: [target.data.id],
      ...(branchFromId === previousId ? { branchIds: Array.from(new Set([...previous.branchIds, target.data.id])) } : {})
    })
  }]
  if (branchFromId && branchFromId !== previousId) {
    const parent = records.find((record) => record.id === branchFromId)!
    changes.push({
      path: parent.path,
      beforeText: parent.raw,
      afterText: stringifyFrontMatter(parent.content, { ...parent.data, branchIds: Array.from(new Set([...parent.branchIds, target.data.id])) })
    })
  }
  const result = await commitTextChanges(store, `restore-legacy-event-${entry.id}-${Date.now()}`, changes, async () => {
    await store.move(trashPath(entry), entry.originalPath)
    try {
      await store.writeText(entry.originalPath, targetAfter)
    } catch (error) {
      await store.move(entry.originalPath, trashPath(entry)).catch(() => undefined)
      throw error
    }
  })
  if (!result.ok) throw new Error(result.text)
}

export async function moveToTrash(store: FileStore, entry: TrashEntry): Promise<void> {
  if (!isSafeEntry({ ...entry, trashPath: entry.trashPath ?? trashPath(entry) })) throw new Error('回收站条目路径无效')
  const target = trashPath(entry)
  await store.ensureDir(target.slice(0, target.lastIndexOf('/')))
  if (!(await store.exists(entry.originalPath))) throw new Error(`待删除实体不存在：${entry.originalPath}`)
  if (await store.exists(target)) throw new Error(`回收站中已存在同一实体：${entry.id}`)
  await store.move(entry.originalPath, target)
  const entries = (await readIndex(store)).filter((item) => item.id !== entry.id)
  entries.push({ ...entry, trashPath: target })
  await writeIndex(store, entries)
}

export async function listTrash(store: FileStore): Promise<TrashEntry[]> {
  return (await readIndex(store)).sort((a, b) => b.deletedAt - a.deletedAt)
}

export async function restoreFromTrash(store: FileStore, id: string, placement?: EventRestorePlacement): Promise<void> {
  const entries = await readIndex(store)
  const entry = entries.find((item) => item.id === id)
  if (!entry) throw new Error(`回收站中未找到实体：${id}`)
  if (await store.exists(entry.originalPath)) throw new Error(`恢复目标已存在：${entry.originalPath}`)
  const source = trashPath(entry)
  if (!(await store.exists(source))) throw new Error(`回收站文件不存在：${source}`)
  if (entry.kind === 'event') {
    if (entry.eventConnections) await restoreEventGraph(store, entry)
    else if (placement) await restoreLegacyEventWithPlacement(store, entry, placement)
    else throw new Error('RESTORE_REQUIRES_PLACEMENT：旧回收站事件没有连接快照，请提供 placement')
  } else await store.move(source, entry.originalPath)
  await restoreRelatedRelationships(store, entry.relatedRelationships)
  await writeIndex(store, entries.filter((item) => item.id !== id))
}

export async function purgeTrashEntry(store: FileStore, id: string): Promise<void> {
  const entries = await readIndex(store)
  const entry = entries.find((item) => item.id === id)
  if (!entry) return
  await store.remove(trashPath(entry))
  await writeIndex(store, entries.filter((item) => item.id !== id))
}

export function makeTrashEntry(input: {
  id: string
  kind: EntityKind
  originalPath: string
  title: string
  deletedAt?: number
  relatedRelationships?: Relationship[]
  eventConnections?: TrashEntry['eventConnections']
}): TrashEntry {
  return { ...input, deletedAt: input.deletedAt ?? Date.now() }
}
