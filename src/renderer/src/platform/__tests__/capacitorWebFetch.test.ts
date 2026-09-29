import { describe, expect, it, vi } from 'vitest'
import { createCapacitorWebFetch } from '../capacitorWebFetch'

describe('Capacitor web search transport', () => {
  it('passes JSON-RPC requests to native HTTP and returns a Fetch response', async () => {
    const request = vi.fn(async (_options: unknown) => ({ status: 200, data: '{"ok":true}', headers: { 'content-type': 'application/json' }, url: 'https://api.example/mcp' }))
    const fetcher = createCapacitorWebFetch(request as never)
    const response = await fetcher('https://api.example/mcp', { method: 'POST', body: '{"jsonrpc":"2.0"}', headers: { 'content-type': 'application/json' }, redirect: 'error' })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example/mcp', method: 'POST', data: '{"jsonrpc":"2.0"}', disableRedirects: true }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('returns promptly when the caller cancels a pending native request', async () => {
    const request = vi.fn(async () => new Promise<never>(() => {}))
    const fetcher = createCapacitorWebFetch(request as never)
    const controller = new AbortController()
    const pending = fetcher('https://api.example/mcp', { signal: controller.signal })
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
  })
})
