import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAutosave } from '../autosave'

describe('createAutosave', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('空闲到点后只保存一次', () => {
    vi.useFakeTimers()
    const runs: number[] = []
    const autosave = createAutosave(15000)

    autosave.schedule(() => runs.push(1))
    vi.advanceTimersByTime(10000)
    autosave.schedule(() => runs.push(2))
    vi.advanceTimersByTime(15000)

    expect(runs).toEqual([2])
  })

  it('cancel 阻止保存', () => {
    vi.useFakeTimers()
    const runs: string[] = []
    const autosave = createAutosave(5000)

    autosave.schedule(() => runs.push('a'))
    autosave.cancel()
    vi.advanceTimersByTime(10000)

    expect(runs).toEqual([])
  })

  it('间隔为 0 表示关闭', () => {
    vi.useFakeTimers()
    const runs: string[] = []
    const autosave = createAutosave(0)

    autosave.schedule(() => runs.push('a'))
    vi.advanceTimersByTime(60000)

    expect(runs).toEqual([])
  })
})
