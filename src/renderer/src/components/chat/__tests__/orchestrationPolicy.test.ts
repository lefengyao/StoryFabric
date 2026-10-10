import { expect, it } from 'vitest'
import { orchestrationStartEnabled } from '../orchestrationPolicy'

it('keeps the orchestration action disabled until capabilities explicitly confirm support', () => {
  expect(orchestrationStartEnabled(undefined, false)).toBe(false)
  expect(orchestrationStartEnabled({ orchestration: false }, false)).toBe(false)
  expect(orchestrationStartEnabled({ orchestration: true }, false)).toBe(true)
})
