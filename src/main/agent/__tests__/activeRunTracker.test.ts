import { describe, expect, it, vi } from 'vitest'
import { ActiveRunTracker } from '../activeRunTracker'

describe('ActiveRunTracker', () => {
  it('keeps background work active until the last concurrent run finishes', () => {
    const onChange = vi.fn()
    const tracker = new ActiveRunTracker(onChange)

    const finishFirst = tracker.begin()
    const finishSecond = tracker.begin()
    finishFirst()
    expect(onChange.mock.calls).toEqual([[true]])

    finishSecond()
    expect(onChange.mock.calls).toEqual([[true], [false]])
  })

  it('makes a run release idempotent', () => {
    const onChange = vi.fn()
    const tracker = new ActiveRunTracker(onChange)
    const finish = tracker.begin()

    finish()
    finish()

    expect(onChange.mock.calls).toEqual([[true], [false]])
  })
})
