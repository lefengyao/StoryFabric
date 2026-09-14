import { expect, it } from 'vitest'
import { RunBudget } from '../budget'

it('atomically accepts only one of two concurrent reservations for the last call', async () => {
  const budget = new RunBudget({ maxCalls: 1, maxEstimatedTokens: 1000 })
  const outcomes = await Promise.all([
    budget.reserve({ callId: 'a', estimatedInputTokens: 100, maxOutputTokens: 100 }),
    budget.reserve({ callId: 'b', estimatedInputTokens: 100, maxOutputTokens: 100 })
  ])
  expect(outcomes.filter((item) => item.accepted)).toHaveLength(1)
})

it('is idempotent by call id and distinguishes missing usage from zero usage', async () => {
  const budget = new RunBudget({ maxCalls: 2, maxEstimatedTokens: 1000 })
  expect((await budget.reserve({ callId: 'same', estimatedInputTokens: 100, maxOutputTokens: 100 })).accepted).toBe(true)
  expect((await budget.reserve({ callId: 'same', estimatedInputTokens: 100, maxOutputTokens: 100 })).accepted).toBe(true)
  expect(budget.settle({ callId: 'same' }).usageSource).toBe('missing')
  expect(budget.snapshot()).toMatchObject({ callsStarted: 1, callsSettled: 1, actualTokens: 0 })
})
