/** Anthropic Messages 原生协议适配器 */
import type { ChatMessage, ToolDefJson } from '../../shared/types'
import { httpError, normalizeBaseUrl, type LlmAdapter, type StreamHandlers, type StreamRequest, type StreamResult, type TokenUsage } from './types'
import { buildModelParams } from './modelParams'
import { sseData, sseLines } from './sse'

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_MAX_TOKENS = 8192
const ANTHROPIC_VERSION = '2023-06-01'

interface ContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string
  [k: string]: unknown
}

/** 规范化历史 → Anthropic messages（tool 结果并入其后的 user 轮次） */
export function toAnthropicMessages(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: ContentBlock[] }[] {
  const out: { role: 'user' | 'assistant'; content: ContentBlock[] }[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.text ?? '' }] })
    } else if (m.role === 'assistant') {
      const blocks: ContentBlock[] = []
      if (m.text) blocks.push({ type: 'text', text: m.text })
      for (const tc of m.toolCalls ?? []) {
        let input: unknown = {}
        try {
          input = JSON.parse(tc.argsJson || '{}')
        } catch {
          input = {}
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks })
    } else if (m.role === 'tool') {
      const block: ContentBlock = { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.text ?? '' }
      const last = out[out.length - 1]
      const lastIsToolResults = last && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')
      if (lastIsToolResults) last.content.push(block)
      else out.push({ role: 'user', content: [block] })
    }
  }
  return out
}

export class AnthropicAdapter implements LlmAdapter {
  constructor(private baseUrl: string) {}

  private endpoint(): string {
    const base = normalizeBaseUrl(this.baseUrl)
    return base.endsWith('/messages') ? base : `${base}/v1/messages`
  }

  async stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult> {
    const modelParams = req.params ? buildModelParams('anthropic', model, req.params) : {}
    const body: any = {
      model,
      max_tokens: (modelParams.max_tokens as number | undefined) ?? DEFAULT_MAX_TOKENS,
      stream: true,
      messages: toAnthropicMessages(req.messages),
      ...(modelParams.thinking ? { thinking: modelParams.thinking } : {})
    }
    if (req.system) body.system = req.system
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }))
    }

    const res = await fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal: req.signal
    })
    if (!res.ok) throw await httpError(res)

    let text = ''
    let stopReason: StreamResult['stopReason'] = 'stop'
    let usage: TokenUsage | undefined
    const toolBlocks = new Map<number, { id: string; name: string; args: string }>()

    for await (const line of sseLines(res)) {
      const data = sseData(line)
      if (!data) continue
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      switch (json.type) {
        case 'message_start': {
          const u = json.message?.usage
          if (u) {
            usage = {
              promptTokens: Number(u.input_tokens ?? 0),
              completionTokens: Number(u.output_tokens ?? 0),
              cachedTokens: Number(u.cache_read_input_tokens ?? 0),
              cacheWriteTokens: Number(u.cache_creation_input_tokens ?? 0)
            }
          }
          break
        }
        case 'content_block_start': {
          const b = json.content_block
          if (b?.type === 'tool_use') {
            toolBlocks.set(json.index ?? toolBlocks.size, { id: b.id, name: b.name, args: '' })
          }
          break
        }
        case 'content_block_delta': {
          const d = json.delta
          if (d?.type === 'text_delta' && d.text) {
            text += d.text
            handlers.onText(d.text)
          } else if (d?.type === 'input_json_delta' && d.partial_json) {
            const tb = toolBlocks.get(json.index)
            if (tb) tb.args += d.partial_json
          }
          break
        }
        case 'message_delta': {
          if (json.delta?.stop_reason === 'tool_use') stopReason = 'tool_calls'
          if (json.usage?.output_tokens !== undefined) {
            usage = {
              promptTokens: usage?.promptTokens ?? 0,
              completionTokens: Number(json.usage.output_tokens ?? 0),
              cachedTokens: usage?.cachedTokens ?? 0,
              cacheWriteTokens: usage?.cacheWriteTokens ?? 0
            }
          }
          break
        }
        case 'error': {
          throw new Error(String(json.error?.message ?? 'Anthropic 流错误'))
        }
      }
    }

    const toolCalls = [...toolBlocks.values()].map((tb, i) => ({
      id: tb.id || `call_${i}`,
      name: tb.name,
      argsJson: tb.args || '{}'
    }))
    return { text, toolCalls, stopReason: toolCalls.length ? 'tool_calls' : stopReason, usage }
  }
}

export async function fetchAnthropicModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/v1/models?limit=100`
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
  })
  if (!res.ok) throw await httpError(res)
  const json = (await res.json()) as { data?: { id?: string }[] }
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
}

