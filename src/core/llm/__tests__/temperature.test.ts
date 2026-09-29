import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicAdapter } from '../anthropic'
import { GeminiAdapter } from '../gemini'
import { OpenAICompatibleAdapter } from '../openaiCompatible'
import type { LlmAdapter, StreamRequest } from '../types'
import { agentTemperatureToRawModelTemperature } from '../../../shared/agentGeneration'

const originalFetch = globalThis.fetch
const noopHandlers = { onText: () => undefined }

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(stream, { status: 200 })
}

function request(temperature?: number): StreamRequest {
  return {
    system: '',
    messages: [],
    tools: [],
    params: {
      reasoning: 'off',
      contextTokens: 8192,
      maxOutputTokens: 512,
      ...(temperature === undefined ? {} : { temperature })
    }
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('temperature request serialization', () => {
  const cases: Array<{
    name: string
    adapter: () => LlmAdapter
    response: string[]
    temperatureOf: (body: Record<string, unknown>) => unknown
  }> = [
    {
      name: 'OpenAI-compatible requests',
      adapter: () => new OpenAICompatibleAdapter('https://api.test/v1'),
      response: ['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'],
      temperatureOf: (body) => body.temperature
    },
    {
      name: 'Anthropic requests',
      adapter: () => new AnthropicAdapter('https://api.test'),
      response: ['data: {"type":"message_stop"}\n\n'],
      temperatureOf: (body) => body.temperature
    },
    {
      name: 'Gemini requests',
      adapter: () => new GeminiAdapter('https://api.test'),
      response: ['data: {"candidates":[{"content":{"parts":[]}}]}\n\n'],
      temperatureOf: (body) => (body.generationConfig as Record<string, unknown> | undefined)?.temperature
    }
  ]

  for (const testCase of cases) {
    it(`serializes temperature for ${testCase.name}`, async () => {
      let body: Record<string, unknown> = {}
      vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return sseResponse(testCase.response)
      }))

      await testCase.adapter().stream('test-model', request(0.5), 'key', noopHandlers)

      expect(testCase.temperatureOf(body)).toBe(0.5)
    })

    it(`does not serialize an unset temperature for ${testCase.name}`, async () => {
      let body: Record<string, unknown> = {}
      vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return sseResponse(testCase.response)
      }))

      await testCase.adapter().stream('test-model', request(), 'key', noopHandlers)

      expect(testCase.temperatureOf(body)).toBeUndefined()
    })

    it(`continues without temperature when ${testCase.name} rejects that parameter with 422`, async () => {
      const bodies: Record<string, unknown>[] = []
      vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        bodies.push(body)
        if (testCase.temperatureOf(body) === 0.5) {
          return new Response(JSON.stringify({ error: { message: 'temperature is not supported' } }), { status: 422 })
        }
        return sseResponse(testCase.response)
      }))

      await expect(testCase.adapter().stream('test-model', request(0.5), 'key', noopHandlers)).resolves.toMatchObject({ stopReason: 'stop' })

      expect(bodies).toHaveLength(2)
      expect(testCase.temperatureOf(bodies[1])).toBeUndefined()
    })

    for (const failure of [
      { name: 'a temperature value validation error', status: 422, message: 'temperature value 3 is not allowed' },
      { name: 'an unrelated client error', status: 400, message: 'missing required messages' },
      { name: 'a server error', status: 500, message: 'temperature is not supported' }
    ]) {
      it(`does not retry ${testCase.name} after ${failure.name}`, async () => {
        const bodies: Record<string, unknown>[] = []
        vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          return new Response(JSON.stringify({ error: { message: failure.message } }), { status: failure.status })
        }))

        await expect(testCase.adapter().stream('test-model', request(0.5), 'key', noopHandlers))
          .rejects.toThrow(`请求失败 HTTP ${failure.status}：${failure.message}`)

        expect(bodies).toHaveLength(1)
        expect(testCase.temperatureOf(bodies[0])).toBe(0.5)
      })
    }

    for (const status of [400, 422]) {
      it(`continues without temperature for ${testCase.name} after a structured FastAPI ${status} extra parameter error`, async () => {
        const bodies: Record<string, unknown>[] = []
        vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          bodies.push(body)
          if (testCase.temperatureOf(body) === 0.5) {
            return new Response(JSON.stringify({
              detail: [{ msg: 'Extra inputs are not permitted', loc: ['body', 'temperature'], type: 'extra_forbidden' }]
            }), { status })
          }
          return sseResponse(testCase.response)
        }))

        await expect(testCase.adapter().stream('test-model', request(0.5), 'key', noopHandlers)).resolves.toMatchObject({ stopReason: 'stop' })

        expect(bodies).toHaveLength(2)
        expect(testCase.temperatureOf(bodies[1])).toBeUndefined()
      })
    }

    for (const failure of [
      { status: 400, name: 'a structured unknown-parameter message', detail: [{ loc: ['body', 'temperature'], msg: 'Unknown parameter', type: 'invalid_request' }] },
      { status: 422, name: 'a structured unsupported-parameter type', detail: [{ loc: ['body', 'temperature'], msg: 'Invalid parameter', type: 'unsupported_parameter' }] }
    ]) {
      it(`continues without temperature for ${testCase.name} after ${failure.name}`, async () => {
        const bodies: Record<string, unknown>[] = []
        vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          bodies.push(body)
          if (testCase.temperatureOf(body) === 0.5) return new Response(JSON.stringify({ detail: failure.detail }), { status: failure.status })
          return sseResponse(testCase.response)
        }))

        await expect(testCase.adapter().stream('test-model', request(0.5), 'key', noopHandlers)).resolves.toMatchObject({ stopReason: 'stop' })

        expect(bodies).toHaveLength(2)
        expect(testCase.temperatureOf(bodies[1])).toBeUndefined()
      })
    }

    for (const failure of [
      { name: 'a structured extra-field error for another field', detail: [{ msg: 'Extra inputs are not permitted', loc: ['body', 'top_p'], type: 'extra_forbidden' }] },
      { name: 'a structured temperature range error', detail: [{ msg: 'Input should be less than or equal to 1', loc: ['body', 'temperature'], type: 'less_than_equal' }] },
      { name: 'a structured temperature type error', detail: [{ msg: 'Input should be a valid number', loc: ['body', 'temperature'], type: 'float_type' }] },
      { name: 'a structured temperature unsupported-value error', detail: [{ msg: 'Temperature must be at most 1', loc: ['body', 'temperature'], type: 'unsupported_value' }] }
    ]) {
      it(`does not retry ${testCase.name} after ${failure.name}`, async () => {
        const bodies: Record<string, unknown>[] = []
        vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          return new Response(JSON.stringify({ detail: failure.detail }), { status: 422 })
        }))

        await expect(testCase.adapter().stream('test-model', request(0.5), 'key', noopHandlers)).rejects.toThrow('请求失败 HTTP 422')

        expect(bodies).toHaveLength(1)
        expect(testCase.temperatureOf(bodies[0])).toBe(0.5)
      })
    }
  }

  for (const testCase of cases.filter((item) => item.name === 'OpenAI-compatible requests' || item.name === 'Gemini requests')) {
    it(`does not apply the Anthropic temperature cap to ${testCase.name}`, async () => {
      let body: Record<string, unknown> = {}
      vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return sseResponse(testCase.response)
      }))

      await testCase.adapter().stream('test-model', request(1.2), 'key', noopHandlers)

      expect(testCase.temperatureOf(body)).toBe(1.2)
    })
  }

  for (const testCase of [
    { productTemperature: 0, expected: 1 },
    { productTemperature: 20, expected: 1 },
    { productTemperature: 100, expected: 0.2 }
  ]) {
    it(`caps Anthropic temperature for product temperature ${testCase.productTemperature}`, async () => {
      let body: Record<string, unknown> = {}
      vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return sseResponse(['data: {"type":"message_stop"}\n\n'])
      }))

      await new AnthropicAdapter('https://api.test').stream(
        'test-model',
        request(agentTemperatureToRawModelTemperature(testCase.productTemperature)),
        'key',
        noopHandlers
      )

      expect(body.temperature).toBe(testCase.expected)
    })
  }
})
