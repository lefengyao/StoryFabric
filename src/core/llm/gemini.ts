/** Google Gemini 原生协议适配器 */
import type { ChatMessage } from '../../shared/types'
import { httpError, isUnsupportedTemperatureError, normalizeBaseUrl, parseJsonResponse, type LlmAdapter, type StreamHandlers, type StreamRequest, type StreamResult, type TokenUsage } from './types'
import { buildModelParams } from './modelParams'
import { sseData, sseLines } from './sse'
import { toGeminiMessageParts } from '../attachments/messageContent'
import { assertSafeNetworkUrl } from '../net/safeUrl'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface GeminiPart {
  text?: string
  thoughtSignature?: string
  thought_signature?: string
  functionCall?: {
    name: string
    args?: Record<string, unknown>
    thoughtSignature?: string
    thought_signature?: string
  }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

/** 规范化历史 → Gemini contents */
export function toGeminiContents(messages: ChatMessage[]): { role: 'user' | 'model'; parts: GeminiPart[] }[] {
  const out: { role: 'user' | 'model'; parts: GeminiPart[] }[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', parts: toGeminiMessageParts(m) })
    } else if (m.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (m.text) parts.push({ text: m.text })
      for (const tc of m.toolCalls ?? []) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.argsJson || '{}')
        } catch {
          args = {}
        }
        const functionCallPart: GeminiPart = { functionCall: { name: tc.name, args } }
        if (tc.thoughtSignature) functionCallPart.thoughtSignature = tc.thoughtSignature
        parts.push(functionCallPart)
      }
      if (parts.length) out.push({ role: 'model', parts })
    } else if (m.role === 'tool') {
      let responseText = m.text ?? ''
      try {
        responseText = JSON.stringify({ result: JSON.parse(responseText) })
      } catch {
        responseText = JSON.stringify({ result: responseText })
      }
      out.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.toolName ?? 'tool', response: JSON.parse(responseText) } }]
      })
    }
  }
  return out
}

function nativeGeminiBase(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl)
  const withoutCompatibilityPath = base.replace(/\/v1beta\/openai$/, '')
  return withoutCompatibilityPath.endsWith('/v1beta') ? withoutCompatibilityPath : `${withoutCompatibilityPath}/v1beta`
}

export class GeminiAdapter implements LlmAdapter {
  constructor(private baseUrl: string, private allowPrivateUrls = true, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private readonly fallbackFetcher?: typeof fetch) {}

  private apiBase(): string {
    return nativeGeminiBase(this.baseUrl)
  }

  async stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult> {
    const url = await assertSafeNetworkUrl(`${this.apiBase()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { allowPrivate: this.allowPrivateUrls })
    const body: any = {
      contents: toGeminiContents(req.messages)
    }
    if (req.params) {
      const modelParams = buildModelParams('gemini', model, req.params)
      if (modelParams.generationConfig) body.generationConfig = modelParams.generationConfig
    }
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] }
    if (req.tools.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }
      ]
    }

    const send = (includeTemperature: boolean): Promise<Response> => {
      const requestBody = includeTemperature ? body : { ...body }
      if (!includeTemperature && typeof requestBody.generationConfig === 'object' && requestBody.generationConfig !== null && !Array.isArray(requestBody.generationConfig)) {
        requestBody.generationConfig = { ...requestBody.generationConfig }
        delete requestBody.generationConfig.temperature
      }
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        redirect: 'error',
        body: JSON.stringify(requestBody),
        signal: req.signal
      }
      return this.fetcher(url, init).catch((error: unknown) => {
        if (!this.fallbackFetcher || !(error instanceof TypeError) || req.signal?.aborted) throw error
        return this.fallbackFetcher(url, init)
      })
    }
    let res = await send(req.params?.temperature !== undefined)
    if (!res.ok && await isUnsupportedTemperatureError(res, req.params?.temperature)) res = await send(false)
    if (!res.ok) throw await httpError(res)

    let text = ''
    let stopReason: StreamResult['stopReason'] = 'stop'
    let usage: TokenUsage | undefined
    const toolCalls: StreamResult['toolCalls'] = []

    for await (const line of sseLines(res, req.signal)) {
      const data = sseData(line)
      if (!data) continue
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.error) throw new Error(String(json.error.message ?? 'Gemini 流错误'))
      const feedback = json.promptFeedback
      if (feedback?.blockReason) throw new Error(`请求被安全策略拦截：${feedback.blockReason}`)
      if (json.usageMetadata) {
        const meta = json.usageMetadata
        // 兼容中转站：分片可能只带部分字段，逐字段与已有值合并而不是整体覆盖
        usage = {
          promptTokens: Number(meta.promptTokenCount ?? usage?.promptTokens ?? 0),
          completionTokens: Number(meta.candidatesTokenCount ?? usage?.completionTokens ?? 0),
          cachedTokens: Number(meta.cachedContentTokenCount ?? usage?.cachedTokens ?? 0),
          cacheWriteTokens: usage?.cacheWriteTokens ?? 0
        }
      }
      const candidate = json.candidates?.[0]
      for (const part of candidate?.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text) {
          text += part.text
          handlers.onText(part.text)
        }
        if (part.functionCall?.name) {
          const index = toolCalls.length
          const id = `call_${index}`
          handlers.onToolCallStart?.(id, part.functionCall.name, index)
          const argsJson = JSON.stringify(part.functionCall.args ?? {})
          handlers.onToolCallComplete?.(id, part.functionCall.name, argsJson, index)
          const thoughtSignature = typeof part.thoughtSignature === 'string'
            ? part.thoughtSignature
            : typeof part.thought_signature === 'string'
              ? part.thought_signature
              : typeof part.functionCall.thoughtSignature === 'string'
                ? part.functionCall.thoughtSignature
                : typeof part.functionCall.thought_signature === 'string'
                  ? part.functionCall.thought_signature
                  : undefined
          toolCalls.push({
            id,
            name: part.functionCall.name,
            argsJson,
            ...(thoughtSignature ? { thoughtSignature } : {})
          })
        }
      }
      void stopReason
    }

    return { text, toolCalls, stopReason: toolCalls.length ? 'tool_calls' : 'stop', usage }
  }
}

export async function fetchGeminiModels(baseUrl: string, apiKey: string, options: { allowPrivateUrls?: boolean; fetcher?: typeof fetch } = {}): Promise<string[]> {
  const url = await assertSafeNetworkUrl(`${nativeGeminiBase(baseUrl)}/models?pageSize=200`, { allowPrivate: options.allowPrivateUrls ?? true })
  const res = await (options.fetcher ?? globalThis.fetch.bind(globalThis))(url, { headers: { 'x-goog-api-key': apiKey }, redirect: 'error' })
  if (!res.ok) throw await httpError(res)
  const json = await parseJsonResponse<{ models?: { name?: string; supportedGenerationMethods?: string[] }[] }>(res)
  return (json.models ?? [])
    .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort()
}
