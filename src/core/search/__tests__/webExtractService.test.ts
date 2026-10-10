import { afterEach, describe, expect, it, vi } from 'vitest'
import { webExtract } from '../webExtractService'

const previousFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = previousFetch; vi.restoreAllMocks() })

describe('portable web extraction', () => {
  it('uses the hosted extraction route and unwraps its markdown content', async () => {
    const fetcher = vi.fn(async (_input: unknown) => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify({ url: 'https://example.com/', content: '# Example\n\nA page.' }) }] }
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const result = await webExtract('https://example.com/', { mode: 'free', fetcher: fetcher as typeof fetch })
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.anysearch.com/mcp')
    expect(result.content).toBe('# Example\n\nA page.')
    expect(result.url).toBe('https://example.com/')
  })

  it('uses the self-hosted extraction contract', async () => {
    const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({ url: 'https://example.com/', content: 'Page body', truncated: false }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const result = await webExtract('https://example.com/', { mode: 'self-hosted', selfHostedUrl: 'http://127.0.0.1:8090', fetcher: fetcher as typeof fetch })
    expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:8090/v1/extract')
    expect(result.content).toBe('Page body')
  })

  it('blocks private addresses and refuses extraction while search is off', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(webExtract('http://127.0.0.1/private', { mode: 'free' })).rejects.toThrow()
    await expect(webExtract('https://example.com', { mode: 'off' })).rejects.toThrow('未开启')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('live portable extraction', () => {
  it.skipIf(process.env.STORYFABRIC_LIVE_SEARCH_TEST !== '1')('reads a public page through the bundled hosted client', async () => {
    const result = await webExtract('https://example.com', { mode: 'free' })
    expect(result.content).toContain('Example Domain')
  })

  it.skipIf(process.env.STORYFABRIC_LIVE_SEARCH_TEST !== '1')('reads a public page through the local Docker service', async () => {
    const result = await webExtract('https://example.com', { mode: 'self-hosted' })
    expect(result.content).toContain('This domain')
  }, 35000)
})
