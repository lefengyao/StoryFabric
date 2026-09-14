import type { UsageRecord } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { appendUsage, USAGE_LIMIT } from './usageLog'

const USAGE_PATH = '.storyfabric/usage-records.json'

function isUsageRecord(value: unknown): value is UsageRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.at === 'number' && typeof item.providerId === 'string' && typeof item.providerName === 'string' && typeof item.model === 'string' &&
    typeof item.promptTokens === 'number' && typeof item.completionTokens === 'number' && typeof item.cachedTokens === 'number' && typeof item.cacheWriteTokens === 'number'
}

export class PortableUsageStore {
  constructor(private readonly store: FileStore, private readonly path = USAGE_PATH) {}

  async list(): Promise<UsageRecord[]> {
    const text = await this.store.readText(this.path)
    if (!text) return []
    try {
      const parsed = JSON.parse(text) as unknown
      return Array.isArray(parsed) ? parsed.filter(isUsageRecord) : []
    } catch { return [] }
  }

  async append(record: UsageRecord): Promise<void> {
    const next = appendUsage(await this.list(), record, USAGE_LIMIT)
    await this.store.writeText(this.path, JSON.stringify(next, null, 2))
  }
}
