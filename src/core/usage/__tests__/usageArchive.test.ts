import { expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import type { UsageRecord } from '../../../shared/types'
import { UsageArchiveStore } from '../usageArchive'
import { summarizeUsageBuckets, summarizeUsageBucketHours } from '../usageLog'

const record = (at: number, promptTokens: number, workspaceId = 'project-a'): UsageRecord => ({
  at, workspaceId, providerId: 'p', providerName: 'P', model: 'm',
  promptTokens, completionTokens: 2, cachedTokens: 1, cacheWriteTokens: 0
})

it('migrates legacy raw calls once and retains hourly totals after raw calls are trimmed', async () => {
  const files = new MemoryFileStore()
  const day = new Date(2026, 8, 9, 10).getTime()
  await files.writeText('usage.json', JSON.stringify([record(day, 10)]))
  const usage = new UsageArchiveStore(files, 'usage.json', 'usage-stats', 2)
  expect(await usage.listBuckets()).toMatchObject([{ calls: 1, promptTokens: 10, hourStart: Math.floor(day / 3_600_000) * 3_600_000 }])
  await usage.append(record(day + 1000, 20))
  await usage.append(record(day + 2000, 30))
  expect(await usage.list()).toHaveLength(2)
  expect(await usage.listBuckets()).toMatchObject([{ calls: 3, promptTokens: 60 }])
  expect((await new UsageArchiveStore(files, 'usage.json', 'usage-stats', 2).listBuckets())[0].calls).toBe(3)
  const buckets = await usage.listBuckets()
  expect(summarizeUsageBuckets(buckets, { now: day }).calls).toBe(3)
  expect(summarizeUsageBucketHours(buckets, '2026-09-09')[10].promptTokens).toBe(60)
})
