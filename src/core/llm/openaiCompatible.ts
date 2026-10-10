/** OpenAI 兼容协议适配器（覆盖 OpenAI / DeepSeek / Kimi / 智谱 / 各类中转站 / Ollama 等） */
import type { ChatMessage, ToolDefJson } from '../../shared/types'
import { httpError, isUnsupportedTemperatureError, normalizeBaseUrl, parseJsonResponse, type LlmAdapter, type StreamHandlers, type StreamRequest, type StreamResult, type TokenUsage } from './types'
import { buildModelParams } from './modelParams'
import { sseData, sseLines } from './sse'
import { toOpenAiMessageContent } from '../attachments/messageContent'
import { assertSafeNetworkUrl } from '../net/safeUrl'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toOpenAiMessages(system: string, messages: ChatMessage[]): any[] {
  const out: any[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: toOpenAiMessageContent(m) })
    } else if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.text ?? null }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.argsJson || '{}' }
        }))
      }
      out.push(msg)
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.text ?? '' })
    }
  }
  return out
}

function toOpenAiTools(tools: ToolDefJson[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

export class OpenAICompatibleAdapter implements LlmAdapter {
  constructor(private baseUrl: string, private allowPrivateUrls = true, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  private endpoint(): string {
    const base = normalizeBaseUrl(this.baseUrl)
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  }

  async stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult> {
    const endpoint = await assertSafeNetworkUrl(this.endpoint(), { allowPrivate: this.allowPrivateUrls })
    const body: any = {
      model,
      stream: true,
      messages: toOpenAiMessages(req.system, req.messages),
      ...(req.params ? buildModelParams('openai', model, req.params) : {})
    }
    if (req.tools.length) body.tools = toOpenAiTools(req.tools)

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    }
    const send = (includeUsage: boolean, includeTemperature: boolean): Promise<Response> => {
      const requestBody = includeTemperature ? body : { ...body }
      if (!includeTemperature) delete requestBody.temperature
      return this.fetcher(endpoint, {
        method: 'POST',
        headers,
        redirect: 'error',
        // 只有显式声明才在流末尾返回 usage
        body: JSON.stringify(includeUsage ? { ...requestBody, stream_options: { include_usage: true } } : requestBody),
        signal: req.signal
      })
    }

    let includeUsage = true
    let includeTemperature = req.params?.temperature !== undefined
    let res = await send(includeUsage, includeTemperature)
    for (let fallbackCount = 0; !res.ok && fallbackCount < 2; fallbackCount++) {
      // 少数 OpenAI 兼容服务不认 stream_options：仅在明确报该字段时退回。
      if (includeUsage && res.status === 400 && (await res.clone().text()).includes('stream_options')) {
        includeUsage = false
        res = await send(includeUsage, includeTemperature)
        continue
      }
      // 仅对明确拒绝该能力的服务移除 temperature；其他错误仍按原路径抛出。
      if (includeTemperature && await isUnsupportedTemperatureError(res, req.params?.temperature)) {
        includeTemperature = false
        res = await send(includeUsage, includeTemperature)
        continue
      }
      break
    }
    if (!res.ok) throw await httpError(res)

    let text = ''
    let stopReason: StreamResult['stopReason'] = 'stop'
    let usage: TokenUsage | undefined
    const calls = new Map<number, { id: string; name: string; args: string; started?: boolean }>()

    for await (const line of sseLines(res, req.signal)) {
      const data = sseData(line)
      if (!data || data === '[DONE]') continue
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.error) throw new Error(String(json.error.message ?? JSON.stringify(json.error)))
      if (json.usage) {
        usage = {
          promptTokens: Number(json.usage.prompt_tokens ?? 0),
          completionTokens: Number(json.usage.completion_tokens ?? 0),
          cachedTokens: Number(json.usage.prompt_tokens_details?.cached_tokens ?? json.usage.prompt_cache_hit_tokens ?? 0),
          cacheWriteTokens: 0
        }
      }
      const choice = json.choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? {}
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content
        handlers.onText(delta.content)
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = typeof tc.index === 'number' ? tc.index : calls.size
        const cur = calls.get(idx) ?? { id: '', name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (!cur.started && cur.id && cur.name) { cur.started = true; handlers.onToolCallStart?.(cur.id, cur.name, idx) }
        if (tc.function?.arguments) {
          cur.args += tc.function.arguments
          handlers.onToolArgsDelta?.(cur.id || `call_${idx}`, tc.function.arguments, idx)
        }
        calls.set(idx, cur)
      }
      if (choice.finish_reason === 'tool_calls') stopReason = 'tool_calls'
      else if (choice.finish_reason === 'stop') stopReason = 'stop'
    }

    const toolCalls = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, c]) => {
        const id = c.id || `call_${i}`
        const argsJson = c.args || '{}'
        handlers.onToolCallComplete?.(id, c.name, argsJson, i)
        return { id, name: c.name, argsJson }
      })
    return { text, toolCalls, stopReason: toolCalls.length ? 'tool_calls' : stopReason, usage }
  }
}

/** 拉取 OpenAI 兼容服务的模型列表 */
export async function fetchOpenAiModels(baseUrl: string, apiKey: string, options: { allowPrivateUrls?: boolean; fetcher?: typeof fetch } = {}): Promise<string[]> {
  const url = await assertSafeNetworkUrl(`${normalizeBaseUrl(baseUrl)}/models`, { allowPrivate: options.allowPrivateUrls ?? true })
  const res = await (options.fetcher ?? globalThis.fetch.bind(globalThis))(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, redirect: 'error' })
  if (!res.ok) throw await httpError(res)
  const json = await parseJsonResponse<{ data?: { id?: string }[] }>(res)
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .sort()
}
