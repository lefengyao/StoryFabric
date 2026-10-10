import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGeminiModels, GeminiAdapter } from '../gemini'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('Gemini endpoint selection', () => {
  it.each([
    'https://generativelanguage.googleapis.com',
    'https://generativelanguage.googleapis.com/v1beta',
    'https://generativelanguage.googleapis.com/v1beta/openai'
  ])('lists native models from %s with the supplied transport', async (baseUrl) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }]
    }), { status: 200 })) as unknown as typeof fetch

    await expect(fetchGeminiModels(baseUrl, 'secret', { fetcher })).resolves.toEqual(['gemini-test'])
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200' }),
      expect.objectContaining({ headers: { 'x-goog-api-key': 'secret' } })
    )
  })

  it('uses the native endpoint for generation even if the compatibility URL was pasted', async () => {
    const fetcher = vi.fn(async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200 })) as unknown as typeof fetch
    const adapter = new GeminiAdapter('https://generativelanguage.googleapis.com/v1beta/openai', true, fetcher)

    await adapter.stream('gemini-test', { system: '', messages: [], tools: [], signal: undefined }, 'secret', { onText: () => undefined })
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse' }),
      expect.any(Object)
    )
  })

  it('retries a WebView network failure through the Android transport', async () => {
    const browserFetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    const nativeFetch = vi.fn(async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200 })) as unknown as typeof fetch
    const adapter = new GeminiAdapter('https://generativelanguage.googleapis.com/v1beta', true, browserFetch, nativeFetch)

    const result = await adapter.stream('gemini-test', { system: '', messages: [], tools: [], signal: undefined }, 'secret', { onText: () => undefined })
    expect(result.text).toBe('ok')
    expect(browserFetch).toHaveBeenCalledOnce()
    expect(nativeFetch).toHaveBeenCalledOnce()
  })
})
