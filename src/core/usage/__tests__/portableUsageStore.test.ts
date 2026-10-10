import { expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { PortableUsageStore } from '../portableUsageStore'

it('persists run-attributed usage and keeps missing usage distinguishable', async () => {
  const store = new PortableUsageStore(new MemoryFileStore())
  await store.append({
    at: 1, providerId: 'p', providerName: 'P', model: 'm', promptTokens: 12, completionTokens: 4,
    cachedTokens: 0, cacheWriteTokens: 0, callId: 'c1', runId: 'r1', purpose: 'stage', usageSource: 'missing'
  })
  expect(await store.list()).toHaveLength(1)
  expect((await store.list())[0].usageSource).toBe('missing')
})
