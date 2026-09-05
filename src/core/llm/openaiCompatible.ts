/** OpenAI 兼容协议适配器（覆盖 OpenAI / DeepSeek / Kimi / 智谱 / 各类中转站 / Ollama 等） */
import type { ChatMessage, ToolDefJson } from '../../shared/types'
import { httpError, normalizeBaseUrl, type LlmAdapter, type StreamHandlers, type StreamRequest, type StreamResult } from './types'
import { sseData, sseLines } from './sse'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toOpenAiMessages(system: string, messages: ChatMessage[]): any[] {
  const out: any[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text ?? '' })
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
  constructor(private baseUrl: string) {}

  private endpoint(): string {
    const base = normalizeBaseUrl(this.baseUrl)
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  }

  async stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult> {
    const body: any = {
      model,
      stream: true,
      messages: toOpenAiMessages(req.system, req.messages)
    }
    if (req.tools.length) body.tools = toOpenAiTools(req.tools)

    const res = await fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: req.signal
    })
    if (!res.ok) throw await httpError(res)

    let text = ''
    let stopReason: StreamResult['stopReason'] = 'stop'
    const calls = new Map<number, { id: string; name: string; args: string }>()

    for await (const line of sseLines(res)) {
      const data = sseData(line)
      if (!data || data === '[DONE]') continue
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.error) throw new Error(String(json.error.message ?? JSON.stringify(json.error)))
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
        if (tc.function?.arguments) cur.args += tc.function.arguments
        calls.set(idx, cur)
      }
      if (choice.finish_reason === 'tool_calls') stopReason = 'tool_calls'
      else if (choice.finish_reason === 'stop') stopReason = 'stop'
    }

    const toolCalls = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, argsJson: c.args || '{}' }))
    return { text, toolCalls, stopReason: toolCalls.length ? 'tool_calls' : stopReason }
  }
}

/** 拉取 OpenAI 兼容服务的模型列表 */
export async function fetchOpenAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/models`
  const res = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} })
  if (!res.ok) throw await httpError(res)
  const json = (await res.json()) as { data?: { id?: string }[] }
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .sort()
}

