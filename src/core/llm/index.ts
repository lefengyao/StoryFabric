/** 协议适配器工厂与模型列表拉取 */
import type { Protocol } from '../../shared/types'
import { AnthropicAdapter, fetchAnthropicModels } from './anthropic'
import { GeminiAdapter, fetchGeminiModels } from './gemini'
import { OpenAICompatibleAdapter, fetchOpenAiModels } from './openaiCompatible'
import type { LlmAdapter } from './types'

export function getAdapter(protocol: Protocol, baseUrl: string, options: { allowPrivateUrls?: boolean; fetcher?: typeof fetch; fallbackFetcher?: typeof fetch } = {}): LlmAdapter {
  const allowPrivateUrls = options.allowPrivateUrls ?? true
  switch (protocol) {
    case 'anthropic':
      return new AnthropicAdapter(baseUrl, allowPrivateUrls, options.fetcher)
    case 'gemini':
      return new GeminiAdapter(baseUrl, allowPrivateUrls, options.fetcher, options.fallbackFetcher)
    case 'openai':
    default:
      return new OpenAICompatibleAdapter(baseUrl, allowPrivateUrls, options.fetcher)
  }
}

export async function fetchProviderModels(protocol: Protocol, baseUrl: string, apiKey: string, options: { allowPrivateUrls?: boolean; fetcher?: typeof fetch } = {}): Promise<string[]> {
  const allowPrivateUrls = options.allowPrivateUrls ?? true
  switch (protocol) {
    case 'anthropic':
      return fetchAnthropicModels(baseUrl, apiKey, { allowPrivateUrls, fetcher: options.fetcher })
    case 'gemini':
      return fetchGeminiModels(baseUrl, apiKey, { allowPrivateUrls, fetcher: options.fetcher })
    case 'openai':
    default:
      return fetchOpenAiModels(baseUrl, apiKey, { allowPrivateUrls, fetcher: options.fetcher })
  }
}

export * from './types'

