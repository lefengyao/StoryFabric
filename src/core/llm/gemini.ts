/** Google Gemini 原生协议适配器 */
import type { ChatMessage } from '../../shared/types'
import { httpError, normalizeBaseUrl, type LlmAdapter, type StreamHandlers, type StreamRequest, type StreamResult, type TokenUsage } from './types'
import { buildModelParams } from './modelParams'
import { sseData, sseLines } from './sse'
import { toGeminiMessageParts } from '../attachments/messageContent'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
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
        parts.push({ functionCall: { name: tc.name, args } })
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

export class GeminiAdapter implements LlmAdapter {
  constructor(private baseUrl: string) {}

  private apiBase(): string {
    const base = normalizeBaseUrl(this.baseUrl)
    return base.endsWith('/v1beta') ? base : `${base}/v1beta`
  }

  async stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult> {
    const url = `${this.apiBase()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
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

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: req.signal
    })
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
          toolCalls.push({
            id,
            name: part.functionCall.name,
            argsJson
          })
        }
      }
      void stopReason
    }

    return { text, toolCalls, stopReason: toolCalls.length ? 'tool_calls' : 'stop', usage }
  }
}

export async function fetchGeminiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl).replace(/\/v1beta$/, '')}/v1beta/models?pageSize=200`
  const res = await fetch(url, { headers: { 'x-goog-api-key': apiKey } })
  if (!res.ok) throw await httpError(res)
  const json = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
  return (json.models ?? [])
    .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort()
}
