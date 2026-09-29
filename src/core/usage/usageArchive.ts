import type { UsageRecord } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { appendUsage, parseUsageLog, USAGE_LIMIT } from './usageLog'

/** One durable hour/model/project bucket. Raw calls may be trimmed independently. */
export interface UsageBucket {
  hourStart: number
  workspaceId?: string
  providerId: string
  providerName: string
  model: string
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cacheWriteTokens: number
}

const safe = (value: number): number => Number.isFinite(value) ? value : 0
const validAt = (at: number): boolean => Number.isFinite(at) && Math.abs(at) <= 8.64e15
const monthOf = (at: number): string => new Date(at).toISOString().slice(0, 7)
const keyOf = (bucket: UsageBucket): string => JSON.stringify([bucket.hourStart, bucket.workspaceId ?? '', bucket.providerId, bucket.model])

function bucketOf(record: UsageRecord): UsageBucket {
  return {
    hourStart: Math.floor(record.at / 3_600_000) * 3_600_000,
    workspaceId: record.workspaceId,
    providerId: record.providerId,
    providerName: record.providerName,
    model: record.model,
    calls: 1,
    promptTokens: safe(record.promptTokens),
    completionTokens: safe(record.completionTokens),
    cachedTokens: safe(record.cachedTokens),
    cacheWriteTokens: safe(record.cacheWriteTokens)
  }
}

function merge(rows: UsageBucket[], additions: UsageBucket[]): UsageBucket[] {
  const byKey = new Map(rows.map((row) => [keyOf(row), { ...row }]))
  for (const item of additions) {
    const prior = byKey.get(keyOf(item))
    if (prior) {
      prior.calls += item.calls
      prior.promptTokens += item.promptTokens
      prior.completionTokens += item.completionTokens
      prior.cachedTokens += item.cachedTokens
      prior.cacheWriteTokens += item.cacheWriteTokens
    } else byKey.set(keyOf(item), { ...item })
  }
  return [...byKey.values()].sort((a, b) => a.hourStart - b.hourStart || keyOf(a).localeCompare(keyOf(b)))
}

function parseBuckets(raw: string | null): UsageBucket[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is UsageBucket => item && typeof item === 'object' &&
      Number.isFinite(item.hourStart) && typeof item.providerId === 'string' && typeof item.model === 'string' &&
      Number.isFinite(item.calls) && Number.isFinite(item.promptTokens) && Number.isFinite(item.completionTokens) &&
      Number.isFinite(item.cachedTokens) && Number.isFinite(item.cacheWriteTokens))
  } catch { return [] }
}

export class UsageArchiveStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: FileStore, private readonly rawPath: string, private readonly archiveDir: string, private readonly limit = USAGE_LIMIT) {}

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.queue.then(action, action)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async migrate(): Promise<void> {
    const marker = `${this.archiveDir}/manifest.json`
    if (await this.store.readText(marker)) return
    const byMonth = new Map<string, UsageBucket[]>()
    for (const record of parseUsageLog(await this.store.readText(this.rawPath))) {
      if (!validAt(record.at)) continue
      const month = monthOf(record.at)
      byMonth.set(month, [...(byMonth.get(month) ?? []), bucketOf(record)])
    }
    for (const [month, rows] of byMonth) await this.store.writeText(`${this.archiveDir}/${month}.json`, JSON.stringify(merge([], rows)))
    await this.store.writeText(marker, JSON.stringify({ version: 1 }))
  }

  list(): Promise<UsageRecord[]> {
    return this.serial(async () => parseUsageLog(await this.store.readText(this.rawPath)))
  }

  listBuckets(): Promise<UsageBucket[]> {
    return this.serial(async () => {
      await this.migrate()
      const files = (await this.store.listFiles(this.archiveDir, '.json')).filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
      const rows = await Promise.all(files.map((name) => this.store.readText(`${this.archiveDir}/${name}`).then(parseBuckets)))
      return rows.flat().sort((a, b) => a.hourStart - b.hourStart)
    })
  }

  append(record: UsageRecord): Promise<void> {
    return this.serial(async () => {
      await this.migrate()
      if (validAt(record.at)) {
        const path = `${this.archiveDir}/${monthOf(record.at)}.json`
        const prior = parseBuckets(await this.store.readText(path))
        await this.store.writeText(path, JSON.stringify(merge(prior, [bucketOf(record)])))
      }
      const next = appendUsage(parseUsageLog(await this.store.readText(this.rawPath)), record, this.limit)
      await this.store.writeText(this.rawPath, JSON.stringify(next))
    })
  }
}
