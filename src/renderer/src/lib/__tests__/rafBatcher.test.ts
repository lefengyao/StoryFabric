import { describe, expect, it } from 'vitest'
import { createRafBatcher } from '../rafBatcher'

/** 可控的调度器：记录回调，由测试手动触发。 */
function manualScheduler(): { schedule: (cb: () => void) => number; run: () => void; pending: () => number } {
  const callbacks = new Map<number, () => void>()
  let nextId = 1
  return {
    schedule: (cb) => {
      const id = nextId++
      callbacks.set(id, cb)
      return id
    },
    run: () => {
      const entries = [...callbacks.entries()]
      callbacks.clear()
      for (const [, cb] of entries) cb()
    },
    pending: () => callbacks.size
  }
}

describe('createRafBatcher', () => {
  it('同一帧内的多次 push 只回调一次，并保留顺序', () => {
    const scheduler = manualScheduler()
    const batches: string[][] = []
    const batcher = createRafBatcher<string>((values) => batches.push(values), { schedule: scheduler.schedule, cancel: () => {} })

    batcher.push('a')
    batcher.push('b')
    batcher.push('c')
    expect(batches).toEqual([])
    expect(scheduler.pending()).toBe(1)

    scheduler.run()
    expect(batches).toEqual([['a', 'b', 'c']])
  })

  it('回调后再次 push 会重新调度', () => {
    const scheduler = manualScheduler()
    const batches: string[][] = []
    const batcher = createRafBatcher<string>((values) => batches.push(values), { schedule: scheduler.schedule, cancel: () => {} })

    batcher.push('a')
    scheduler.run()
    batcher.push('b')
    scheduler.run()

    expect(batches).toEqual([['a'], ['b']])
  })

  it('flush 立即回调并取消待执行的调度', () => {
    const scheduler = manualScheduler()
    const batches: string[][] = []
    const batcher = createRafBatcher<string>((values) => batches.push(values), { schedule: scheduler.schedule, cancel: () => {} })

    batcher.push('a')
    batcher.flush()
    expect(batches).toEqual([['a']])

    scheduler.run()
    expect(batches).toEqual([['a']])
  })

  it('没有待处理值时 flush 不回调', () => {
    const batches: string[][] = []
    const batcher = createRafBatcher<string>((values) => batches.push(values), { schedule: () => 1, cancel: () => {} })
    batcher.flush()
    expect(batches).toEqual([])
  })
})
