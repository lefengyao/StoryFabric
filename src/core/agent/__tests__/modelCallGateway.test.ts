import { expect, it, vi } from 'vitest'
import { ModelCallGateway } from '../modelCallGateway'

it('counts a call once and rejects a request after the shared budget is exhausted', async () => {
  const gateway = new ModelCallGateway({ maxCalls: 1, maxEstimatedTokens: 1000 })
  const call = vi.fn(async () => ({ value: 'ok', usage: { promptTokens: 40, completionTokens: 10, cachedTokens: 0, cacheWriteTokens: 0 } }))

  await expect(gateway.call({ callId: 'call-1', runId: 'run-1', purpose: 'stage', estimatedInputTokens: 100, maxOutputTokens: 100, execute: call })).resolves.toMatchObject({ value: 'ok' })
  await expect(gateway.call({ callId: 'call-2', runId: 'run-1', purpose: 'stage', estimatedInputTokens: 100, maxOutputTokens: 100, execute: call })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })
  expect(call).toHaveBeenCalledOnce()
})

it('explains which budget dimension stopped the next model call', async () => {
  const gateway = new ModelCallGateway({ maxCalls: 1, maxEstimatedTokens: 30_000_000 })
  await gateway.call({ callId: 'call-1', runId: 'run-1', purpose: 'stage', estimatedInputTokens: 100, maxOutputTokens: 100, execute: async () => ({ value: 'ok' }) })

  let error: { code: string; reason: string; snapshot: { callsStarted: number; maxCalls: number; maxEstimatedTokens: number }; message: string } | undefined
  try {
    await gateway.call({
      callId: 'call-2',
      runId: 'run-1',
      purpose: 'stage',
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
      execute: async () => ({ value: 'not reached' })
    })
  } catch (cause) {
    error = cause as typeof error
  }

  expect(error).toBeDefined()
  const budgetError = error!
  expect(budgetError).toMatchObject({
    code: 'BUDGET_EXCEEDED',
    reason: 'calls',
    snapshot: { callsStarted: 1, maxCalls: 1, maxEstimatedTokens: 30_000_000 }
  })
  expect(budgetError.message).toContain('调用 1/1')
  expect(budgetError.message).toContain('Token')
})

it('reuses the same in-flight and completed result for a duplicate call id', async () => {
  const gateway = new ModelCallGateway({ maxCalls: 2, maxEstimatedTokens: 1000 })
  const call = vi.fn(async () => ({ value: 'same' }))
  const input = { callId: 'same-call', runId: 'run-1', purpose: 'stage' as const, estimatedInputTokens: 10, maxOutputTokens: 10, execute: call }
  const [first, second] = await Promise.all([gateway.call(input), gateway.call(input)])
  expect(first).toEqual(second)
  expect(call).toHaveBeenCalledOnce()
})

it('retries a bounded transient transport failure without creating another logical budget call', async () => {
  const gateway = new ModelCallGateway({ maxCalls: 1, maxEstimatedTokens: 1000 })
  let attempts = 0
  const call = vi.fn(async () => {
    attempts += 1
    if (attempts === 1) throw Object.assign(new Error('上游请求超时'), { code: 'ETIMEDOUT' })
    return { value: 'recovered' }
  })

  await expect(gateway.call({ callId: 'retry-call', runId: 'run-1', purpose: 'stage', estimatedInputTokens: 100, maxOutputTokens: 100, maxAttempts: 2, execute: call })).resolves.toMatchObject({ value: 'recovered' })
  expect(call).toHaveBeenCalledTimes(2)
  expect(gateway.budget.snapshot()).toMatchObject({ callsStarted: 1, callsSettled: 1 })
})
