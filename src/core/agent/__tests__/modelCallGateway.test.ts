import { expect, it, vi } from 'vitest'
import { ModelCallGateway } from '../modelCallGateway'

it('counts a call once and rejects a request after the shared budget is exhausted', async () => {
  const gateway = new ModelCallGateway({ maxCalls: 1, maxEstimatedTokens: 1000 })
  const call = vi.fn(async () => ({ value: 'ok', usage: { promptTokens: 40, completionTokens: 10, cachedTokens: 0, cacheWriteTokens: 0 } }))

  await expect(gateway.call({ callId: 'call-1', runId: 'run-1', purpose: 'stage', estimatedInputTokens: 100, maxOutputTokens: 100, execute: call })).resolves.toMatchObject({ value: 'ok' })
  await expect(gateway.call({ callId: 'call-2', runId: 'run-1', purpose: 'stage', estimatedInputTokens: 100, maxOutputTokens: 100, execute: call })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })
  expect(call).toHaveBeenCalledOnce()
})

it('reuses the same in-flight and completed result for a duplicate call id', async () => {
  const gateway = new ModelCallGateway({ maxCalls: 2, maxEstimatedTokens: 1000 })
  const call = vi.fn(async () => ({ value: 'same' }))
  const input = { callId: 'same-call', runId: 'run-1', purpose: 'stage' as const, estimatedInputTokens: 10, maxOutputTokens: 10, execute: call }
  const [first, second] = await Promise.all([gateway.call(input), gateway.call(input)])
  expect(first).toEqual(second)
  expect(call).toHaveBeenCalledOnce()
})
