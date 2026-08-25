/** 协议适配器工厂与模型列表拉取 */
import type { Protocol } from '../../shared/types'
import { AnthropicAdapter, fetchAnthropicModels } from './anthropic'
import { GeminiAdapter, fetchGeminiModels } from './gemini'
import { OpenAICompatibleAdapter, fetchOpenAiModels } from './openaiCompatible'
import type { LlmAdapter } from './types'

export function getAdapter(protocol: Protocol, baseUrl: string): LlmAdapter {
  switch (protocol) {
    case 'anthropic':
      return new AnthropicAdapter(baseUrl)
    case 'gemini':
      return new GeminiAdapter(baseUrl)
    case 'openai':
    default:
      return new OpenAICompatibleAdapter(baseUrl)
  }
}

export async function fetchProviderModels(protocol: Protocol, baseUrl: string, apiKey: string): Promise<string[]> {
  switch (protocol) {
    case 'anthropic':
      return fetchAnthropicModels(baseUrl, apiKey)
    case 'gemini':
      return fetchGeminiModels(baseUrl, apiKey)
    case 'openai':
    default:
      return fetchOpenAiModels(baseUrl, apiKey)
  }
}

export * from './types'
