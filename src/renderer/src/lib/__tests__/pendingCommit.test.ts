import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyedDebounce } from '../pendingCommit'

describe('createKeyedDebounce', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('不同 key 的待提交互不取消', () => {
    vi.useFakeTimers()
    const calls: Array<[string, string]> = []
    const debounce = createKeyedDebounce<'light' | 'dark'>(400, (key, value) => calls.push([key, value]))

    debounce.schedule('light', '#111111')
    vi.advanceTimersByTime(200)
    debounce.schedule('dark', '#222222')
    vi.advanceTimersByTime(400)

    expect(calls).toEqual([
      ['light', '#111111'],
      ['dark', '#222222']
    ])
  })

  it('同一 key 的连续调用只提交最后一次', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const debounce = createKeyedDebounce<'light'>(400, (_key, value) => calls.push(value))

    debounce.schedule('light', '#111111')
    vi.advanceTimersByTime(100)
    debounce.schedule('light', '#333333')
    vi.advanceTimersByTime(400)

    expect(calls).toEqual(['#333333'])
  })

  it('cancel 可取消单个或全部待提交', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const debounce = createKeyedDebounce<'a' | 'b'>(400, (key) => calls.push(key))

    debounce.schedule('a', '1')
    debounce.schedule('b', '2')
    debounce.cancel('a')
    vi.advanceTimersByTime(400)
    expect(calls).toEqual(['b'])

    debounce.schedule('a', '3')
    debounce.cancel()
    vi.advanceTimersByTime(400)
    expect(calls).toEqual(['b'])
  })
})
