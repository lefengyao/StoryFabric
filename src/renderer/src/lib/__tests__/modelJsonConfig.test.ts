import { describe, expect, it } from 'vitest'
import { formatModelConfigJson, parseModelConfigJson } from '../modelJsonConfig'

describe('per-model JSON configuration', () => {
  it('shows every effective setting and round-trips a model profile', () => {
    const json = formatModelConfigJson('gpt-4o', {})
    expect(JSON.parse(json)).toEqual({
      schemaVersion: 1,
      reasoningSupport: false,
      vision: true,
      reasoning: 'off',
      reasoningMap: null,
      contextTokens: 131072,
      maxOutputTokens: 16384
    })
    expect(parseModelConfigJson(json, 'openai')).toEqual({
      reasoningSupport: false,
      vision: true,
      reasoning: 'off',
      contextTokens: 131072,
      maxOutputTokens: 16384
    })
  })

  it('accepts full custom settings and clears an old mapping when JSON says null', () => {
    const custom = JSON.stringify({
      schemaVersion: 1,
      reasoningSupport: true,
      vision: false,
      reasoning: 'high',
      reasoningMap: null,
      contextTokens: 50000,
      maxOutputTokens: 10000
    })
    expect(parseModelConfigJson(custom, 'openai')).toEqual({
      reasoningSupport: true,
      vision: false,
      reasoning: 'high',
      contextTokens: 50000,
      maxOutputTokens: 10000
    })
  })

  it('represents a blank mapping left by the form as null in the JSON view', () => {
    const json = formatModelConfigJson('gpt-4o', { reasoningMap: { path: '', values: {} } })
    expect(JSON.parse(json).reasoningMap).toBeNull()
  })

  it('accepts protocol-compatible reasoning mappings', () => {
    const json = formatModelConfigJson('claude-custom', {
      reasoningSupport: true,
      reasoning: 'high',
      reasoningMap: { path: 'thinking', values: { high: '{"type":"enabled","budget_tokens":4096}' } }
    })
    expect(parseModelConfigJson(json, 'anthropic').reasoningMap).toEqual({
      path: 'thinking',
      values: { high: '{"type":"enabled","budget_tokens":4096}' }
    })
  })

  it('rejects OpenAI reasoning_effort in native Gemini JSON and accepts Gemini thinkingBudget mapping', () => {
    const base = JSON.parse(formatModelConfigJson('gemini-2.5-pro', {})) as Record<string, unknown>
    const wrong = {
      ...base,
      reasoningSupport: true,
      reasoning: 'medium',
      reasoningMap: { path: 'reasoning_effort', values: { medium: 'medium' } }
    }
    expect(() => parseModelConfigJson(JSON.stringify(wrong), 'gemini')).toThrow('Gemini')

    const native = {
      ...wrong,
      reasoningMap: { path: 'generationConfig.thinkingConfig.thinkingBudget', values: { medium: '8192' } }
    }
    expect(parseModelConfigJson(JSON.stringify(native), 'gemini').reasoningMap).toEqual(native.reasoningMap)
  })

  it.each([
    ['not JSON', '不是有效 JSON'],
    ['[]', '必须是 JSON 对象'],
    ['{"schemaVersion":2}', 'schemaVersion'],
    ['{"schemaVersion":1,"vision":true}', 'reasoningSupport']
  ])('rejects an incomplete or malformed document: %s', (source, message) => {
    expect(() => parseModelConfigJson(source, 'openai')).toThrow(message)
  })

  it('rejects unknown fields, invalid limits and unsafe mappings before changing a model', () => {
    const base = JSON.parse(formatModelConfigJson('gpt-4o', {})) as Record<string, unknown>
    expect(() => parseModelConfigJson(JSON.stringify({ ...base, apiKey: 'secret' }), 'openai')).toThrow('不支持的字段')
    expect(() => parseModelConfigJson(JSON.stringify({ ...base, contextTokens: -1 }), 'openai')).toThrow('contextTokens')
    expect(() => parseModelConfigJson(JSON.stringify({ ...base, maxOutputTokens: 200000 }), 'openai')).toThrow('maxOutputTokens')
    expect(() => parseModelConfigJson(JSON.stringify({ ...base, reasoningMap: { path: '__proto__.x', values: { high: '1' } } }), 'openai')).toThrow('reasoningMap')
    expect(() => parseModelConfigJson(JSON.stringify({ ...base, reasoningMap: { path: 'reasoning_effort', values: { high: 'high' } } }), 'anthropic')).toThrow('Anthropic')
  })
})
