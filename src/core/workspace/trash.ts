import type { EntityKind, Relationship, TrashEntry } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { normalizeRelativePath } from '../storage/fileStore'

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

export async function restoreFromTrash(store: FileStore, id: string): Promise<void> {
  const entries = await readIndex(store)
  const entry = entries.find((item) => item.id === id)
  if (!entry) throw new Error(`回收站中未找到实体：${id}`)
  if (await store.exists(entry.originalPath)) throw new Error(`恢复目标已存在：${entry.originalPath}`)
  const source = trashPath(entry)
  if (!(await store.exists(source))) throw new Error(`回收站文件不存在：${source}`)
  await store.move(source, entry.originalPath)
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

export function makeTrashEntry(input: { id: string; kind: EntityKind; originalPath: string; title: string; deletedAt?: number; relatedRelationships?: Relationship[] }): TrashEntry {
  return { ...input, deletedAt: input.deletedAt ?? Date.now() }
}
