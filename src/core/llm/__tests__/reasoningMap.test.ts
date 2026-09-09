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
})
