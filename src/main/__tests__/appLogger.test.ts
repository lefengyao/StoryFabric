import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLogger, redactLogUrl } from '../appLogger'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'storyfabric-logger-'))
  directories.push(directory)
  return directory
}

describe('AppLogger', () => {
  it('writes structured logs, mirrors them to the console, and redacts URL secrets', async () => {
    const directory = await makeDirectory()
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new AppLogger({ directory, sink, now: () => Date.parse('2026-09-29T05:00:00.000Z') })

    await logger.info('network.request', { url: 'https://example.test/v1/models?api_key=secret&trace=ok' })
    await logger.flush()

    const file = join(directory, 'storyfabric-2026-09-29.log')
    const content = await readFile(file, 'utf8')
    expect(content).toContain('network.request')
    expect(content).toContain('trace=ok')
    expect(content).not.toContain('secret')
    expect(sink.log).toHaveBeenCalledOnce()
    expect(redactLogUrl('https://example.test/?token=secret')).toBe('https://example.test/?token=%5Bredacted%5D')
  })

  it('removes expired files and then enforces the total log size limit', async () => {
    const directory = await makeDirectory()
    const now = Date.parse('2026-09-29T05:00:00.000Z')
    const oldFile = join(directory, 'storyfabric-2026-09-01.log')
    const keptFile = join(directory, 'storyfabric-2026-09-28.log')
    const newestFile = join(directory, 'storyfabric-2026-09-29.log')
    await writeFile(oldFile, 'old')
    await writeFile(keptFile, 'older-but-valid')
    await writeFile(newestFile, 'newest')
    await utimes(oldFile, new Date(now - 30 * 86_400_000), new Date(now - 30 * 86_400_000))
    await utimes(keptFile, new Date(now - 86_400_000), new Date(now - 86_400_000))
    await utimes(newestFile, new Date(now), new Date(now))

    const logger = new AppLogger({ directory, now: () => now, retentionDays: 7, maxTotalBytes: 10 })
    await logger.cleanup()

    expect(await readdir(directory)).toEqual(['storyfabric-2026-09-29.log'])
  })
})
