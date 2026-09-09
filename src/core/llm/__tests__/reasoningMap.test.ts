import { describe, expect, it } from 'vitest'
import { parseReasoningValue, setByPath } from '../reasoningMap'

describe('parseReasoningValue', () => {
  it('解析数字、布尔与带引号字符串', () => {
    expect(parseReasoningValue('2048')).toBe(2048)
    expect(parseReasoningValue('true')).toBe(true)
    expect(parseReasoningValue('"low"')).toBe('low')
  })

  it('非 JSON 时按裸字符串处理，并去掉首尾空白', () => {
    expect(parseReasoningValue('low')).toBe('low')
    expect(parseReasoningValue('  high  ')).toBe('high')
  })

  it('空值返回 undefined', () => {
    expect(parseReasoningValue('')).toBeUndefined()
    expect(parseReasoningValue('   ')).toBeUndefined()
    expect(parseReasoningValue(undefined)).toBeUndefined()
  })

  it('JSON null 视为没填', () => {
    expect(parseReasoningValue('null')).toBeUndefined()
  })
})

describe('setByPath', () => {
  it('写入单层路径', () => {
    const body: Record<string, unknown> = {}
    setByPath(body, 'reasoning_effort', 'high')
    expect(body).toEqual({ reasoning_effort: 'high' })
  })

  it('逐级建对象，且不覆盖已有同级字段', () => {
    const body: Record<string, unknown> = { generationConfig: { maxOutputTokens: 8192 } }
    setByPath(body, 'generationConfig.thinkingConfig.thinkingBudget', 4096)
    expect(body).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 4096 } }
    })
  })

  it('路径为空或含空段时忽略', () => {
    const body: Record<string, unknown> = {}
    setByPath(body, '', 1)
    setByPath(body, 'a..b', 1)
    setByPath(body, '.a', 1)
    setByPath(body, 'a.', 1)
    expect(body).toEqual({})
  })

  it('拒绝原型链相关路径，避免污染 Object.prototype', () => {
    const body: Record<string, unknown> = {}
    setByPath(body, '__proto__.polluted', 1)
    setByPath(body, 'constructor.prototype.x', 1)
    setByPath(body, 'a.prototype.b', 1)
    expect(body).toEqual({})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('拒绝请求体保留字段，避免映射覆盖模型名与消息体', () => {
    const body: Record<string, unknown> = { model: 'deepseek-chat', messages: [], max_tokens: 8192 }
    setByPath(body, 'model', 'hijacked')
    setByPath(body, 'messages.0.role', 'system')
    setByPath(body, 'max_tokens', 1)
    expect(body).toEqual({ model: 'deepseek-chat', messages: [], max_tokens: 8192 })
  })

  it('非保留键仍按现状覆盖中间层（文档化当前行为）', () => {
    const body: Record<string, unknown> = { a: 1 }
    setByPath(body, 'a.b', 2)
    expect(body).toEqual({ a: { b: 2 } })
  })
})
