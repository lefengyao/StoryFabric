/**
 * 模型用量日志：存于 userData/usage.json（服务端为 data/usage.json）。
 * 只保留最近 USAGE_LIMIT 条；读写排队，避免并发读改写互相覆盖。
 */
import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { UsageRecord } from '../../shared/types'
import { USAGE_LIMIT, appendUsage, parseUsageLog } from './usageLog'

export class UsageService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  list(): Promise<UsageRecord[]> {
    return this.serialized(async () => parseUsageLog(await this.read()))
  }

  append(record: UsageRecord): Promise<void> {
    return this.serialized(async () => {
      const next = appendUsage(parseUsageLog(await this.read()), record, USAGE_LIMIT)
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf-8')
    })
  }

  private async read(): Promise<string | null> {
    try {
      return await fs.readFile(this.filePath, 'utf-8')
    } catch {
      return null
    }
  }
}
