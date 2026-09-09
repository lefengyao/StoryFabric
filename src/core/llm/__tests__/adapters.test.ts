import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnthropicAdapter, toAnthropicMessages } from '../anthropic'
import { GeminiAdapter, toGeminiContents } from '../gemini'
import { OpenAICompatibleAdapter } from '../openaiCompatible'
import type { ChatMessage } from '../../../shared/types'

/* ---------- mock fetch 返回 SSE 流 ---------- */

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    }
  })
  return new Response(stream, { status: 200 })
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const noopHandlers = { onText: () => {} }

describe('OpenAICompatibleAdapter', () => {
  it('解析文本与工具调用增量，拼接完整结果', async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      expect(String(url)).toBe('https://api.test.com/v1/chat/completions')
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"list_characters","arguments":""}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"x\\":1}"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n'
      ])
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new OpenAICompatibleAdapter('https://api.test.com/v1/')
    const deltas: string[] = []
    const result = await adapter.stream('m1', { system: '', messages: [], tools: [], signal: undefined }, 'sk-key', {
      onText: (d) => deltas.push(d)
    })

    expect(deltas).toEqual(['你好'])
    expect(result.text).toBe('你好')
    expect(result.stopReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'list_characters', argsJson: '{"x":1}' }])
    // 鉴权头
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-key')
  })

  it('解析流末尾 usage，并在请求中声明 include_usage', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":30,"prompt_tokens_details":{"cached_tokens":64}}}\n\n',
          'data: [DONE]\n\n'
        ])
      })
    )

    const adapter = new OpenAICompatibleAdapter('https://api.test.com/v1')
    const result = await adapter.stream('m1', { system: '', messages: [], tools: [], signal: undefined }, 'k', noopHandlers)

    expect(capturedBody.stream_options).toEqual({ include_usage: true })
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 30, cachedTokens: 64, cacheWriteTokens: 0 })
  })

  it('兼容 DeepSeek 的 prompt_cache_hit_tokens 缓存字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":30,"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":56}}\n\n',
          'data: [DONE]\n\n'
        ])
      )
    )

    const adapter = new OpenAICompatibleAdapter('https://api.deepseek.com/v1')
    const result = await adapter.stream('deepseek-chat', { system: '', messages: [], tools: [], signal: undefined }, 'k', noopHandlers)

    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 30, cachedTokens: 64, cacheWriteTokens: 0 })
  })

  it('服务不认 stream_options 时退回重试一次', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        if (bodies.length === 1) {
          return new Response('{"error":{"message":"Unrecognized request argument supplied: stream_options"}}', { status: 400 })
        }
        return sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])
      })
    )

    const adapter = new OpenAICompatibleAdapter('https://api.test.com/v1')
    const result = await adapter.stream('m1', { system: '', messages: [], tools: [], signal: undefined }, 'k', noopHandlers)

    expect(bodies).toHaveLength(2)
    expect(bodies[0].stream_options).toEqual({ include_usage: true })
    expect(bodies[1].stream_options).toBeUndefined()
    expect(result.text).toBe('ok')
  })
})

describe('AnthropicAdapter', () => {
  it('按事件流解析 text_delta 与 input_json_delta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: message_start\ndata: {"type":"message_start"}\n\n',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"晨光"}}\n\n',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t9","name":"get_outline"}}\n\n',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
          'data: {"type":"message_stop"}\n\n'
        ])
      )
    )
    const adapter = new AnthropicAdapter('https://api.anthropic.com')
    const result = await adapter.stream('claude-x', { system: '', messages: [], tools: [], signal: undefined }, 'k', noopHandlers)
    expect(result.text).toBe('晨光')
    expect(result.toolCalls[0]).toMatchObject({ id: 't9', name: 'get_outline', argsJson: '{}' })
  })

  it('合并 message_start 与 message_delta 的用量', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":200,"output_tokens":1,"cache_read_input_tokens":150,"cache_creation_input_tokens":20}}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":45}}\n\n',
          'data: {"type":"message_stop"}\n\n'
        ])
      )
    )

    const adapter = new AnthropicAdapter('https://api.anthropic.com')
    const result = await adapter.stream('claude-x', { system: '', messages: [], tools: [], signal: undefined }, 'k', noopHandlers)

    expect(result.usage).toEqual({ promptTokens: 200, completionTokens: 45, cachedTokens: 150, cacheWriteTokens: 20 })
  })

  it('历史转换：连续 tool 结果合并进同一 user 轮', () => {
    const msgs: ChatMessage[] = [
      { id: 'a', role: 'user', text: '查一下' },
      { id: 'b', role: 'assistant', toolCalls: [{ id: 't1', name: 'f1', argsJson: '{}' }] },
      { id: 'c', role: 'tool', toolCallId: 't1', toolName: 'f1', text: '结果A' },
      { id: 'd', role: 'tool', toolCallId: 't2', toolName: 'f2', text: '结果B' },
      { id: 'e', role: 'assistant', text: '完成' }
    ]
    const out = toAnthropicMessages(msgs)
    expect(out).toHaveLength(4)
    expect(out[2].role).toBe('user')
    expect(out[2].content.every((b) => b.type === 'tool_result')).toBe(true)
    expect(out[2].content).toHaveLength(2)
    expect(out[3].role).toBe('assistant')
  })
})

describe('GeminiAdapter', () => {
  it('解析 parts 与 functionCall；请求含 systemInstruction', async () => {
    let capturedBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body))
        return sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"星夜"}],"role":"model"}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_character","args":{"name":"林晚"}}}],"role":"model"},"finishReason":"STOP"}]}\n\n'
        ])
      })
    )
    const adapter = new GeminiAdapter('https://generativelanguage.googleapis.com')
    const result = await adapter.stream(
      'gemini-2.0-flash',
      {
        system: 'sys提示',
        messages: [{ id: 'u1', role: 'user', text: '你好' }],
        tools: [{ name: 'get_character', description: 'd', parameters: { type: 'object', properties: {} } }],
        signal: undefined
      },
      'gkey',
      noopHandlers
    )

    expect(result.text).toBe('星夜')
    expect(result.toolCalls[0]?.name).toBe('get_character')
    expect(JSON.parse(result.toolCalls[0]?.argsJson ?? '{}')).toEqual({ name: '林晚' })

    const body = capturedBody as { systemInstruction?: { parts: { text: string }[] }; contents: unknown[] }
    expect(body.systemInstruction?.parts[0].text).toBe('sys提示')
  })

  it('解析 usageMetadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"星"}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"夜"}]}}],"usageMetadata":{"promptTokenCount":300,"candidatesTokenCount":50,"cachedContentTokenCount":128}}\n\n'
        ])
      )
    )

    const adapter = new GeminiAdapter('https://generativelanguage.googleapis.com')
    const result = await adapter.stream('gemini-2.0-flash', { system: '', messages: [], tools: [], signal: undefined }, 'k', noopHandlers)

    expect(result.usage).toEqual({ promptTokens: 300, completionTokens: 50, cachedTokens: 128, cacheWriteTokens: 0 })
  })

  it('分片 usageMetadata 逐字段合并而不是整体覆盖', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"星"}]}}],"usageMetadata":{"promptTokenCount":300,"candidatesTokenCount":1}}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"夜"}]}}],"usageMetadata":{"candidatesTokenCount":50}}\n\n'
        ])
      )
    )

    const adapter = new GeminiAdapter('https://generativelanguage.googleapis.com')
    const result = await adapter.stream('gemini-2.0-flash', { system: '', messages: [], tools: [], signal: undefined }, 'k', noopHandlers)

    expect(result.usage).toEqual({ promptTokens: 300, completionTokens: 50, cachedTokens: 0, cacheWriteTokens: 0 })
  })

  it('工具结果转为 functionResponse', () => {
    const out = toGeminiContents([
      { id: 'b', role: 'assistant', toolCalls: [{ id: 't1', name: 'f1', argsJson: '{"q":1}' }] },
      { id: 'c', role: 'tool', toolCallId: 't1', toolName: 'f1', text: '{"ok":true}' }
    ])
    expect(out[1].parts[0].functionResponse).toEqual({ name: 'f1', response: { result: { ok: true } } })
  })
})
