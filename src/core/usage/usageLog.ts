/** 模型用量记录：纯函数读写与聚合，不依赖平台（main / server / renderer 共用）。 */
import type { UsageRecord } from '../../shared/types'
import type { UsageBucket } from './usageArchive'

/** 保留最近多少次调用记录（超出后丢弃最旧的）。 */
export const USAGE_LIMIT = 5000

function isUsageRecord(value: unknown): value is UsageRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.at === 'number' &&
    typeof item.providerId === 'string' &&
    typeof item.providerName === 'string' &&
    typeof item.model === 'string' &&
    typeof item.promptTokens === 'number' &&
    typeof item.completionTokens === 'number' &&
    typeof item.cachedTokens === 'number' &&
    typeof item.cacheWriteTokens === 'number'
  )
}

export function parseUsageLog(text: string | null): UsageRecord[] {
  if (!text) return []
  try {
    const raw = JSON.parse(text) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(isUsageRecord)
  } catch {
    return []
  }
}

export function appendUsage(records: UsageRecord[], record: UsageRecord, limit = USAGE_LIMIT): UsageRecord[] {
  const next = [...records, record]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export interface UsageModelStat {
  providerId: string
  providerName: string
  model: string
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  /** 缓存命中率 = cachedTokens / promptTokens（无输入时为 0） */
  cacheHitRate: number
}

export interface UsageDayStat {
  /** 本地日期 YYYY-MM-DD */
  date: string
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

export interface UsageHourStat {
  /** 本地小时 0–23 */
  hour: number
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

export interface UsageStats {
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cacheHitRate: number
  byModel: UsageModelStat[]
  byDay: UsageDayStat[]
}

export function usageDateKey(at: number): string {
  const d = new Date(at)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Tuple encoding keeps providers with identical model names distinct. */
export function usageModelKey(providerId: string, model: string): string {
  return JSON.stringify([providerId, model])
}

export function filterUsageByModel(records: UsageRecord[], modelKey: string | null): UsageRecord[] {
  return modelKey === null ? records : records.filter((record) => usageModelKey(record.providerId, record.model) === modelKey)
}

export function filterUsageByWorkspace(records: UsageRecord[], workspaceId: string | null): UsageRecord[] {
  return workspaceId === null ? records : records.filter((record) => record.workspaceId === workspaceId)
}

/** A selected local calendar day always has 24 hour buckets, including idle hours. */
export function summarizeUsageHours(records: UsageRecord[], date: string): UsageHourStat[] {
  const hours = Array.from({ length: 24 }, (_, hour): UsageHourStat => ({
    hour, calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0
  }))
  for (const record of records) {
    if (!Number.isFinite(record.at) || usageDateKey(record.at) !== date) continue
    const bucket = hours[new Date(record.at).getHours()]
    bucket.calls += 1
    bucket.promptTokens += safe(record.promptTokens)
    bucket.completionTokens += safe(record.completionTokens)
    bucket.cachedTokens += safe(record.cachedTokens)
  }
  return hours
}

function rate(cached: number, prompt: number): number {
  return Number.isFinite(prompt) && prompt > 0 && Number.isFinite(cached) ? cached / prompt : 0
}

/** 非法数值（NaN/Infinity）按 0 计，避免污染总量。 */
function safe(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function summarizeUsage(records: UsageRecord[], options: { now?: number; days?: number } = {}): UsageStats {
  const now = options.now ?? Date.now()
  const days = Math.max(1, options.days ?? 14)

  let calls = 0
  let promptTokens = 0
  let completionTokens = 0
  let cachedTokens = 0
  const models = new Map<string, UsageModelStat>()

  for (const record of records) {
    calls += 1
    promptTokens += safe(record.promptTokens)
    completionTokens += safe(record.completionTokens)
    cachedTokens += safe(record.cachedTokens)

    const key = usageModelKey(record.providerId, record.model)
    const current = models.get(key) ?? {
      providerId: record.providerId,
      providerName: record.providerName,
      model: record.model,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cacheHitRate: 0
    }
    current.calls += 1
    current.promptTokens += safe(record.promptTokens)
    current.completionTokens += safe(record.completionTokens)
    current.cachedTokens += safe(record.cachedTokens)
    current.cacheHitRate = rate(current.cachedTokens, current.promptTokens)
    models.set(key, current)
  }

  const byModel = [...models.values()].sort((a, b) => {
    const diff = b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens)
    if (diff !== 0) return diff
    // 总量相同时按模型名、供应商 id 排序，保证跨刷新顺序稳定
    return a.model.localeCompare(b.model) || a.providerId.localeCompare(b.providerId)
  })

  const windowStart = new Date(now)
  windowStart.setHours(0, 0, 0, 0)
  windowStart.setDate(windowStart.getDate() - (days - 1))
  const buckets = new Map<string, UsageDayStat>()
  for (let i = 0; i < days; i++) {
    const d = new Date(windowStart)
    d.setDate(d.getDate() + i)
    const key = usageDateKey(d.getTime())
    buckets.set(key, { date: key, calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0 })
  }
  for (const record of records) {
    const bucket = buckets.get(usageDateKey(record.at))
    if (!bucket) continue
    bucket.calls += 1
    bucket.promptTokens += safe(record.promptTokens)
    bucket.completionTokens += safe(record.completionTokens)
    bucket.cachedTokens += safe(record.cachedTokens)
  }

  return {
    calls,
    promptTokens,
    completionTokens,
    cachedTokens,
    cacheHitRate: rate(cachedTokens, promptTokens),
    byModel,
    byDay: [...buckets.values()]
  }
}

function bucketRecords(buckets: UsageBucket[]): UsageRecord[] {
  return buckets.map((bucket) => ({
    at: bucket.hourStart,
    workspaceId: bucket.workspaceId,
    providerId: bucket.providerId,
    providerName: bucket.providerName,
    model: bucket.model,
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    cachedTokens: bucket.cachedTokens,
    cacheWriteTokens: bucket.cacheWriteTokens
  }))
}

export function summarizeUsageBuckets(buckets: UsageBucket[], options: { now?: number; days?: number } = {}): UsageStats {
  const stats = summarizeUsage(bucketRecords(buckets), options)
  stats.calls = buckets.reduce((sum, bucket) => sum + bucket.calls, 0)
  const modelCalls = new Map<string, number>()
  const dayCalls = new Map<string, number>()
  for (const bucket of buckets) {
    const model = usageModelKey(bucket.providerId, bucket.model)
    modelCalls.set(model, (modelCalls.get(model) ?? 0) + bucket.calls)
    const date = usageDateKey(bucket.hourStart)
    dayCalls.set(date, (dayCalls.get(date) ?? 0) + bucket.calls)
  }
  for (const model of stats.byModel) model.calls = modelCalls.get(usageModelKey(model.providerId, model.model)) ?? 0
  for (const day of stats.byDay) day.calls = dayCalls.get(day.date) ?? 0
  return stats
}

export function summarizeUsageBucketHours(buckets: UsageBucket[], date: string): UsageHourStat[] {
  const hours = summarizeUsageHours(bucketRecords(buckets), date)
  for (const hour of hours) hour.calls = 0
  for (const bucket of buckets) {
    if (usageDateKey(bucket.hourStart) === date) hours[new Date(bucket.hourStart).getHours()].calls += bucket.calls
  }
  return hours
}
