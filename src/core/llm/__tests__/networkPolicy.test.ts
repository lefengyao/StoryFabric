import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProviderModels, getAdapter } from '../index'

describe('LLM network policy', () => {
  afterEach(() => vi.restoreAllMocks())

  it('blocks private model endpoints in server mode before issuing a request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    await expect(fetchProviderModels('openai', 'http://127.0.0.1:11434/v1', 'key', { allowPrivateUrls: false }))
      .rejects.toThrow(/本机或内网/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps private endpoints available when explicitly enabled for desktop development', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 }))
    const models = await fetchProviderModels('openai', 'http://127.0.0.1:11434/v1', '', { allowPrivateUrls: true })
    expect(models).toEqual(['local-model'])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(getAdapter('openai', 'http://127.0.0.1:11434/v1', { allowPrivateUrls: false })).toBeTruthy()
  })

  it('disables redirects so a provider cannot pivot a server request to another host', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await fetchProviderModels('openai', 'https://provider.example/v1', '', { allowPrivateUrls: false })
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'error' })
    )
  })

  it.each(['openai', 'anthropic', 'gemini'] as const)(
    '%s model listing reports an HTML response as an endpoint or proxy error',
    async (protocol) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        '<!doctype html><html><body>proxy sign-in</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      ))

      await expect(fetchProviderModels(protocol, 'https://provider.example/v1', 'secret'))
        .rejects.toThrow(/返回了 HTML.*代理.*Base URL/u)
    }
  )
})
