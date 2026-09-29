import { afterEach, describe, expect, it, vi } from 'vitest'
import { webSearch } from '../webSearchService'

const previousFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = previousFetch
  vi.restoreAllMocks()
})

const freeResponse = () => new Response(JSON.stringify({
  jsonrpc: '2.0', id: 1,
  result: { content: [{ type: 'text', text: JSON.stringify({ sources: [{ url: 'https://free.example/article', title: '免费来源', snippet: '摘要' }] }) }] }
}), { status: 200, headers: { 'content-type': 'application/json' } })

describe('StoryFabric web search routing', () => {
  it('does not contact a search service when the chat switch is off', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(webSearch('小说资料', { mode: 'off' })).rejects.toThrow('未开启')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses the free hosted MCP tier and returns citeable sources', async () => {
    const fetcher = vi.fn(async (_input: unknown) => freeResponse())
    vi.stubGlobal('fetch', fetcher)
    const result = await webSearch('小说资料', { mode: 'free', limit: 3 })
    expect(result.results).toEqual([expect.objectContaining({ url: 'https://free.example/article', title: '免费来源' })])
    expect(result.searchedAt).toEqual(expect.any(String))
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.anysearch.com/mcp')
  })

  it('uses the local self-hosted v1 contract when selected', async () => {
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const query = (JSON.parse(String(init?.body)) as { queries: string[] }).queries[0]
      return new Response(JSON.stringify({ results: [{ query, sources: [{ url: 'https://self.example/article', title: '自建来源' }], truncated: false }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await webSearch('自建检索', { mode: 'self-hosted', selfHostedUrl: 'http://127.0.0.1:8090' })
    expect(result.results[0]?.url).toBe('https://self.example/article')
    expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:8090/v1/search')
  })

  it('uses Anthropic native search for a capable route and falls back to free when native fails', async () => {
    const requests: string[] = []
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/v1/messages')) return new Response('unavailable', { status: 503 })
      return freeResponse()
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await webSearch('最新资料', {
      mode: 'auto',
      model: 'claude-sonnet-4',
      provider: { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'test-key' }
    })
    expect(requests).toEqual(['https://api.anthropic.com/v1/messages', 'https://api.anysearch.com/mcp'])
    expect(result.results[0]?.url).toBe('https://free.example/article')
  })

  it('reads source citations from the vendor-native OpenAI Responses route', async () => {
    const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      output: [
        { type: 'web_search_call', id: 'ws_1', status: 'completed' },
        { type: 'message', content: [{ type: 'output_text', text: 'Alpha', annotations: [
          { type: 'url_citation', url: 'https://native.example/a', title: 'A', start_index: 0, end_index: 5 }
        ] }] }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await webSearch('Alpha', {
      mode: 'native',
      model: 'gpt-5',
      provider: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1/chat/completions', apiKey: 'test-key' }
    })
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.openai.com/v1/responses')
    expect(result.results).toEqual([expect.objectContaining({ url: 'https://native.example/a', title: 'A' })])
  })

  it('rejects an explicit native choice for a route the kit cannot support', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(webSearch('资料', { mode: 'native', model: 'gemini-2.5-pro', provider: { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-key' } })).rejects.toThrow('不支持')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('live search connections', () => {
  it.skipIf(process.env.STORYFABRIC_LIVE_SEARCH_TEST !== '1')('connects through the application wrapper to the local Docker search service', async () => {
    const result = await webSearch('OpenAI research', { mode: 'self-hosted', limit: 3 })
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0]?.url).toMatch(/^https?:\/\//)
  })

  it.skipIf(process.env.STORYFABRIC_LIVE_SEARCH_TEST !== '1')('connects through the application wrapper to the free hosted service', async () => {
    const result = await webSearch('OpenAI research', { mode: 'free', limit: 3 })
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0]?.url).toMatch(/^https?:\/\//)
  })
})
