/**
 * 模型用量日志：存于 userData/usage.json（服务端为 data/usage.json）。
 * 只保留最近 USAGE_LIMIT 条；同一实例内的读改写串行化。
 * 注意：队列是实例私有的，多个进程/多个实例同时写同一个文件仍可能互相覆盖；
 * 当前部署（桌面单实例锁、服务端单进程）不会出现，如未来支持共享 data 目录需改为追加写。
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
