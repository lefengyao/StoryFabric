import { createDeployment, nativeProtocolFor } from './webSearchKit/deployment'
import { WebSearchRuntime } from './webSearchKit/runtime'
import { createSearchTool } from './webSearchKit/tool'

export type WebSearchMode = 'off' | 'auto' | 'native' | 'free' | 'self-hosted'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

export interface WebSearchOptions {
  mode?: WebSearchMode
  limit?: number
  signal?: AbortSignal
  model?: string
  provider?: { protocol: 'openai' | 'anthropic' | 'gemini'; baseUrl: string; apiKey: string }
  selfHostedUrl?: string
  fetcher?: typeof fetch
}

function nativeEndpoint(protocol: 'openai' | 'anthropic', baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (protocol === 'anthropic') return base.endsWith('/messages') ? base : `${base}${base.endsWith('/v1') ? '' : '/v1'}/messages`
  const openAiBase = base.replace(/\/chat\/completions$/, '')
  return openAiBase.endsWith('/responses') ? openAiBase : `${openAiBase}/responses`
}

function nativeAvailable(options: WebSearchOptions): options is WebSearchOptions & { model: string; provider: NonNullable<WebSearchOptions['provider']> } {
  if (!options.model || !options.provider?.apiKey) return false
  const protocol = nativeProtocolFor(options.model)
  return (protocol === 'anthropic-messages' && options.provider.protocol === 'anthropic')
    || (protocol === 'openai-responses' && options.provider.protocol === 'openai')
}

export function selfHostedBaseUrl(options: { selfHostedUrl?: string }): string {
  return options.selfHostedUrl
    || (typeof process !== 'undefined' ? process.env.STORYFABRIC_WEB_SEARCH_SELF_HOSTED_URL : undefined)
    || 'http://127.0.0.1:8090'
}

/** Search through the selected web-search-kit deployment, preserving source URLs for citations. */
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<{ query: string; results: WebSearchResult[]; searchedAt: string; provider: string; content?: string }> {
  const normalized = query.trim()
  if (!normalized) throw new Error('搜索关键词不能为空')
  if (normalized.length > 500) throw new Error('搜索关键词不能超过 500 个字符')
  const mode = options.mode ?? 'free'
  if (mode === 'off') throw new Error('本次对话未开启联网搜索')
  if (mode === 'native' && !nativeAvailable(options)) throw new Error('当前模型或供应商不支持厂商原生联网搜索')
  const limit = Math.max(1, Math.min(8, Number.isFinite(options.limit) ? Math.floor(options.limit as number) : 5))
  const useNative = (mode === 'auto' || mode === 'native') && nativeAvailable(options)
  const useFree = mode === 'auto' || mode === 'free'
  const useSelfHosted = mode === 'auto' || mode === 'self-hosted'
  const deployment = createDeployment({
    activeModel: () => options.model,
    native: useNative ? {
      protocol: nativeProtocolFor(options.model)!,
      endpoint: nativeEndpoint(options.provider.protocol as 'openai' | 'anthropic', options.provider.baseUrl),
      apiKey: options.provider.apiKey,
      model: options.model,
      ...(options.fetcher ? { fetch: options.fetcher } : {})
    } : false,
    free: useFree ? { profile: 'anysearch', ...(options.fetcher ? { fetch: options.fetcher } : {}) } : false,
    selfHosted: useSelfHosted ? { baseURL: selfHostedBaseUrl(options), ...(options.fetcher ? { fetch: options.fetcher } : {}) } : false
  })
  const runtime = new WebSearchRuntime({ searchProvider: () => deployment.searchProviderFor(options.model) })
  deployment.register(runtime)
  const tool = createSearchTool({ runner: runtime, maxResults: limit, maxQueries: 1, timeoutMs: 30000 })
  const result = await tool.execute({ queries: [normalized] }, { signal: options.signal })
  return {
    query: normalized,
    results: result.sources.map((source) => ({
      url: source.url,
      title: source.title || source.url,
      snippet: source.snippet || '无摘要',
      source: new URL(source.url).hostname
    })),
    searchedAt: new Date().toISOString(),
    provider: mode,
    ...(result.content ? { content: result.content } : {})
  }
}
