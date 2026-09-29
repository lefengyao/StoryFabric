import { createDeployment } from './webSearchKit/deployment'
import { createExtractTool } from './webSearchKit/extract-tool'
import { WebSearchRuntime } from './webSearchKit/runtime'
import { selfHostedBaseUrl, type WebSearchMode } from './webSearchService'

export interface WebExtractOptions {
  mode: WebSearchMode
  maxChars?: number
  signal?: AbortSignal
  selfHostedUrl?: string
  fetcher?: typeof fetch
}

function unwrapHostedContent(content: string): string {
  // Anysearch's MCP extract tool returns its page record as a text JSON block.
  // The self-hosted contract returns Markdown directly.
  try {
    const parsed = JSON.parse(content) as { content?: unknown }
    if (typeof parsed.content === 'string') return parsed.content
  } catch { /* ordinary Markdown */ }
  return content
}

/** Fetch a public page through the bundled web-search-kit clients; no uv runtime is required. */
export async function webExtract(url: string, options: WebExtractOptions): Promise<{ url: string; content: string; truncated: boolean; extractedAt: string; provider: string }> {
  if (options.mode === 'off') throw new Error('本次对话未开启网页抓取')
  if (options.mode === 'native') throw new Error('厂商原生搜索模式不提供网页抓取；请选择自动、免费托管或本机自建')
  const useFree = options.mode === 'auto' || options.mode === 'free'
  const useSelfHosted = options.mode === 'auto' || options.mode === 'self-hosted'
  const deployment = createDeployment({
    native: false,
    free: useFree ? { profile: 'anysearch', ...(options.fetcher ? { fetch: options.fetcher } : {}) } : false,
    selfHosted: useSelfHosted ? { baseURL: selfHostedBaseUrl(options), ...(options.fetcher ? { fetch: options.fetcher } : {}) } : false
  })
  const runtime = new WebSearchRuntime({ searchProvider: deployment.searchProviderFor() })
  deployment.register(runtime)
  const maxChars = Math.max(1000, Math.min(50000, Number.isFinite(options.maxChars) ? Math.floor(options.maxChars as number) : 12000))
  // The hosted MCP response wraps Markdown in JSON text. Cap after unwrapping so
  // a normal long page does not leave the model with a half-written JSON string.
  const tool = createExtractTool({ runner: runtime, maxContentChars: 100000, timeoutMs: 30000 })
  const result = await tool.execute({ url }, { signal: options.signal })
  const content = unwrapHostedContent(result.content)
  return {
    url: result.url,
    content: content.slice(0, maxChars),
    truncated: result.truncated || content.length > maxChars,
    extractedAt: new Date().toISOString(),
    provider: options.mode
  }
}
