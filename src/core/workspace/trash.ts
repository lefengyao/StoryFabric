import type { EntityKind, TrashEntry } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'

const INDEX_PATH = '.storyfabric/trash/index.json'

function trashPath(entry: Pick<TrashEntry, 'kind' | 'id' | 'trashPath'>): string {
  return entry.trashPath ?? `.storyfabric/trash/${entry.kind}/${entry.id}.md`
}

async function readIndex(store: FileStore): Promise<TrashEntry[]> {
  const raw = await store.readText(INDEX_PATH)
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is TrashEntry => {
      return typeof entry?.id === 'string' && typeof entry?.kind === 'string' && typeof entry?.originalPath === 'string' && typeof entry?.deletedAt === 'number' && typeof entry?.title === 'string'
    })
  } catch {
    return []
  }
}

async function writeIndex(store: FileStore, entries: TrashEntry[]): Promise<void> {
  await store.ensureDir('.storyfabric/trash')
  await store.writeText(INDEX_PATH, JSON.stringify(entries, null, 2))
}

export async function moveToTrash(store: FileStore, entry: TrashEntry): Promise<void> {
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
  await writeIndex(store, entries.filter((item) => item.id !== id))
}

export async function purgeTrashEntry(store: FileStore, id: string): Promise<void> {
  const entries = await readIndex(store)
  const entry = entries.find((item) => item.id === id)
  if (!entry) return
  await store.remove(trashPath(entry))
  await writeIndex(store, entries.filter((item) => item.id !== id))
}

export function makeTrashEntry(input: { id: string; kind: EntityKind; originalPath: string; title: string; deletedAt?: number }): TrashEntry {
  return { ...input, deletedAt: input.deletedAt ?? Date.now() }
}
