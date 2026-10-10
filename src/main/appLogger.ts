import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

const DAY_MS = 86_400_000
const LOG_FILE_PATTERN = /^storyfabric-(\d{4}-\d{2}-\d{2})\.log$/u
const SENSITIVE_QUERY_KEY = /(?:api[-_]?key|authorization|password|secret|token|access[-_]?token|refresh[-_]?token)/iu

export interface AppLogSink {
  log: (...values: unknown[]) => void
  warn: (...values: unknown[]) => void
  error: (...values: unknown[]) => void
}

export interface AppLoggerOptions {
  directory: string
  retentionDays?: number
  maxTotalBytes?: number
  sink?: AppLogSink
  now?: () => number
}

interface LogFileInfo {
  name: string
  path: string
  size: number
  modifiedAt: number
}

const defaultSink: AppLogSink = {
  log: (...values) => console.log(...values),
  warn: (...values) => console.warn(...values),
  error: (...values) => console.error(...values)
}

function dateStamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function redactLogString(value: string): string {
  const withUrls = value.replace(/https?:\/\/[^\s"'<>]+/giu, (url) => redactLogUrl(url))
  return withUrls.replace(/((?:api[-_]?key|authorization|password|secret|token)(?:=|:|\s+))[^&\s,;]+/giu, '$1[redacted]')
}

export function redactLogUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[redacted]')
    }
    if (url.username) url.username = '[redacted]'
    if (url.password) url.password = '[redacted]'
    return url.toString()
  } catch {
    return value.replace(/((?:api[-_]?key|authorization|password|secret|token)(?:=|:|\s+))[^&\s,;]+/giu, '$1[redacted]')
  }
}

function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactLogString(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen))
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_QUERY_KEY.test(key) ? '[redacted]' : redactLogValue(item, seen)
  }
  return output
}

export class AppLogger {
  private readonly directory: string
  private readonly retentionDays: number
  private readonly maxTotalBytes: number
  private readonly sink: AppLogSink
  private readonly now: () => number
  private pending: Promise<void> = Promise.resolve()

  constructor(options: AppLoggerOptions) {
    this.directory = options.directory
    this.retentionDays = Math.max(1, Math.floor(options.retentionDays ?? 14))
    this.maxTotalBytes = Math.max(1, Math.floor(options.maxTotalBytes ?? 50 * 1024 * 1024))
    this.sink = options.sink ?? defaultSink
    this.now = options.now ?? Date.now
  }

  info(event: string, details?: unknown): Promise<void> {
    return this.write('info', event, details)
  }

  warn(event: string, details?: unknown): Promise<void> {
    return this.write('warn', event, details)
  }

  error(event: string, details?: unknown): Promise<void> {
    return this.write('error', event, details)
  }

  flush(): Promise<void> {
    return this.pending
  }

  async cleanup(): Promise<void> {
    await this.flush()
    await mkdir(this.directory, { recursive: true })
    const files = await this.listLogFiles()
    const cutoff = this.now() - this.retentionDays * DAY_MS
    const expired = files.filter((file) => file.modifiedAt < cutoff)
    await Promise.all(expired.map((file) => rm(file.path, { force: true })))

    const remaining = files.filter((file) => !expired.includes(file))
      .sort((a, b) => a.modifiedAt - b.modifiedAt || a.name.localeCompare(b.name))
    let total = remaining.reduce((sum, file) => sum + file.size, 0)
    for (const file of remaining) {
      if (total <= this.maxTotalBytes) break
      await rm(file.path, { force: true })
      total -= file.size
    }
  }

  private write(level: 'info' | 'warn' | 'error', event: string, details?: unknown): Promise<void> {
    const timestamp = this.now()
    const line = `${JSON.stringify({ at: new Date(timestamp).toISOString(), level, event, ...(details === undefined ? {} : { details: redactLogValue(details) }) })}\n`
    const file = join(this.directory, `storyfabric-${dateStamp(timestamp)}.log`)
    const operation = this.pending.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true })
      await appendFile(file, line, 'utf8')
      const sink = this.sink[level === 'info' ? 'log' : level]
      sink(`[storyfabric] ${line.trimEnd()}`)
    })
    this.pending = operation.catch((error) => {
      this.sink.error('[storyfabric] log write failed', error)
    })
    return this.pending
  }

  private async listLogFiles(): Promise<LogFileInfo[]> {
    const names = await readdir(this.directory)
    const files: LogFileInfo[] = []
    for (const name of names) {
      if (!LOG_FILE_PATTERN.test(name)) continue
      const path = join(this.directory, basename(name))
      try {
        const info = await stat(path)
        if (info.isFile()) files.push({ name, path, size: info.size, modifiedAt: info.mtimeMs })
      } catch {
        // A concurrent cleanup or antivirus scan may remove a file between readdir and stat.
      }
    }
    return files
  }
}
