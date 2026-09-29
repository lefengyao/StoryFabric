import { afterEach, describe, expect, it, vi } from 'vitest'
import { webSearch } from '../webSearchService'

const previousFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = previousFetch
  vi.restoreAllMocks()
})

describe('webSearch input and cancellation', () => {
  it('rejects empty and oversized queries before making a request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(webSearch('   ', { mode: 'free' })).rejects.toThrow('搜索关键词不能为空')
    await expect(webSearch('x'.repeat(501), { mode: 'free' })).rejects.toThrow('不能超过 500')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('forwards caller cancellation to the hosted provider', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const pending = webSearch('取消', { mode: 'free', signal: controller.signal })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
