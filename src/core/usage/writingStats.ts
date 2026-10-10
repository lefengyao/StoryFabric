import { diffChars } from 'diff'
import { lastItem } from '../../shared/runtimeCompatibility'
import type { FileStore } from '../storage/fileStore'

export interface WritingDay {
  date: string
  added: number
  deleted: number
  net: number
  totalWords: number
  updatedAt: number
}

const ROOT = '.storyfabric/writing-stats'
const queues = new WeakMap<FileStore, Promise<unknown>>()
const count = (text: string): number => text.replace(/\s/g, '').length
const dateOf = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDays(raw: string | null): WritingDay[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is WritingDay => item && typeof item === 'object' &&
      typeof item.date === 'string' && Number.isFinite(item.added) && Number.isFinite(item.deleted) &&
      Number.isFinite(item.net) && Number.isFinite(item.totalWords) && Number.isFinite(item.updatedAt))
  } catch { return [] }
}

export async function listWritingDays(store: FileStore): Promise<WritingDay[]> {
  const files = (await store.listFiles(ROOT, '.json')).filter((file) => /^\d{4}-\d{2}\.json$/.test(file))
  const months = await Promise.all(files.map((file) => store.readText(`${ROOT}/${file}`).then(parseDays)))
  return months.flat().sort((a, b) => a.date.localeCompare(b.date))
}

async function latestWritingDay(store: FileStore, currentPath: string, currentDays: WritingDay[]): Promise<WritingDay | undefined> {
  const files = (await store.listFiles(ROOT, '.json')).filter((file) => /^\d{4}-\d{2}\.json$/.test(file)).sort().reverse()
  for (const file of files) {
    const path = `${ROOT}/${file}`
    const days = path === currentPath ? currentDays : parseDays(await store.readText(path))
    const latest = lastItem([...days].sort((first, second) => first.date.localeCompare(second.date)))
    if (latest) return latest
  }
  return undefined
}

export function writingChange(before: string, after: string): { added: number; deleted: number } {
  if (before === after) return { added: 0, deleted: 0 }
  const changes = diffChars(before, after, { timeout: 100 })
  if (!changes) return { added: count(after), deleted: count(before) }
  return changes.reduce((total, item) => ({
    added: total.added + (item.added ? count(item.value) : 0),
    deleted: total.deleted + (item.removed ? count(item.value) : 0)
  }), { added: 0, deleted: 0 })
}

/** Called only after a chapter write succeeds. The monthly row is durable before the fast baseline marker. */
export function recordChapterWriting(store: FileStore, before: string, after: string, initialTotalAfter?: number, at = Date.now()): Promise<void> {
  const previous = queues.get(store) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(async () => {
    const { added, deleted } = writingChange(before, after)
    if (added === 0 && deleted === 0 && await store.exists(`${ROOT}/current.json`)) return
    const date = dateOf(at)
    const path = `${ROOT}/${date.slice(0, 7)}.json`
    const days = parseDays(await store.readText(path))
    const current = days.find((day) => day.date === date)
    const markerPath = `${ROOT}/current.json`
    let baseline: number | undefined
    let markerUpdatedAt = -1
    try {
      const raw = await store.readText(markerPath)
      const value = raw ? JSON.parse(raw) as { totalWords?: unknown; updatedAt?: unknown } : null
      if (Number.isFinite(value?.totalWords)) baseline = Number(value?.totalWords)
      if (Number.isFinite(value?.updatedAt)) markerUpdatedAt = Number(value?.updatedAt)
    } catch { /* reconstruct from the latest day or caller */ }
    const latestDay = await latestWritingDay(store, path, days)
    if (latestDay && (baseline === undefined || latestDay.updatedAt > markerUpdatedAt)) baseline = latestDay.totalWords
    const net = count(after) - count(before)
    const totalWords = initialTotalAfter ?? Math.max(0, (baseline ?? 0) + net)
    const next: WritingDay = {
      date,
      added: (current?.added ?? 0) + added,
      deleted: (current?.deleted ?? 0) + deleted,
      net: (current?.net ?? 0) + net,
      totalWords,
      updatedAt: at
    }
    await store.writeText(path, JSON.stringify([...days.filter((day) => day.date !== date), next].sort((a, b) => a.date.localeCompare(b.date))))
    await store.writeText(markerPath, JSON.stringify({ version: 1, totalWords, updatedAt: at }))
  })
  queues.set(store, run)
  return run
}
