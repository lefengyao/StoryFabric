import { expect, it } from 'vitest'
import { resolveContextUsagePresentation } from '../contextUsagePresentation'

it('clamps context usage and exposes percent, remaining length and warning tone', () => {
  expect(resolveContextUsagePresentation(720, 1000)).toEqual({ ratio: 0.72, percent: 72, remainingTokens: 280, tone: 'gold' })
  expect(resolveContextUsagePresentation(1200, 1000)).toMatchObject({ ratio: 1, percent: 100, remainingTokens: 0, tone: 'danger' })
})

it('keeps ring details available at the composer without a second context row', () => {
  const view = resolveContextUsagePresentation(37_000, 1_000_000)
  expect(view.percent).toBe(4)
  expect(view.remainingTokens).toBe(963_000)
  expect(view.ratio).toBeCloseTo(0.037)
})
