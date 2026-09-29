import { describe, expect, it } from 'vitest'
import type { ReasoningMap } from '../../../../shared/types'
import {
  addModels,
  filterModels,
  isValidModelName,
  mappingWarning,
  pendingModels,
  removeModel,
  resolveCapability,
  resolveContextWindow,
  setMappingPath,
  setMappingValue
} from '../modelCapability'

describe('resolveCapability', () => {
  it('用户声明优先，未表态时回落档案', () => {
    expect(resolveCapability('gpt-4o')).toEqual({ reasoning: false, vision: true })
    expect(resolveCapability('gpt-4o', { reasoningSupport: true, vision: false })).toEqual({ reasoning: true, vision: false })
    expect(resolveCapability('some-internal', { vision: true })).toEqual({ reasoning: false, vision: true })
  })
})

describe('resolveContextWindow', () => {
  it('ignores invalid persisted limits and falls back to the model profile', () => {
    expect(resolveContextWindow('gpt-5', { contextTokens: 0, maxOutputTokens: Number.NaN })).toEqual({
      contextTokens: 400000,
      maxOutputTokens: 128000
    })
  })
})

describe('模型清单', () => {
  it('添加时去空白、去重、保持顺序', () => {
    expect(addModels(['a'], [' b ', 'a', '', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('删除只移除目标', () => {
    expect(removeModel(['a', 'b', 'a'], 'a')).toEqual(['b'])
  })

  it('候选差集保持服务返回顺序且去重', () => {
    expect(pendingModels(['a'], ['c', 'a', 'b', 'c'])).toEqual(['c', 'b'])
  })

  it('搜索不区分大小写，空查询返回全部', () => {
    expect(filterModels(['GPT-4o', 'deepseek-chat'], 'gpt')).toEqual(['GPT-4o'])
    expect(filterModels(['a', 'b'], '  ')).toEqual(['a', 'b'])
  })

  it('模型名校验拒绝空、换行与超长', () => {
    expect(isValidModelName('gpt-5-internal')).toBe(true)
    expect(isValidModelName('   ')).toBe(false)
    expect(isValidModelName('a\nb')).toBe(false)
    expect(isValidModelName('x'.repeat(201))).toBe(false)
  })
})

describe('映射编辑', () => {
  it('写入路径时保留已有值', () => {
    expect(setMappingPath({ path: 'old', values: { low: '1' } }, 'new')).toEqual({ path: 'new', values: { low: '1' } })
  })

  it('写入值；空字符串表示删除该等级', () => {
    expect(setMappingValue(undefined, 'high', 'true')).toEqual({ path: '', values: { high: 'true' } })
    expect(setMappingValue({ path: 'p', values: { high: 'true' } }, 'high', '  ')).toEqual({ path: 'p', values: {} })
  })

  it('有值但没填参数名时给出提示', () => {
    expect(mappingWarning({ path: '', values: { high: 'true' } })).toBe('请先填写官方参数名')
    expect(mappingWarning({ path: 'a b', values: {} })).toBe('参数名里不能有空格')
    expect(mappingWarning({ path: 'enable_thinking', values: { high: 'true' } })).toBeNull()
    expect(mappingWarning(undefined)).toBeNull()
  })

  it('提示保留字段与协议不匹配的路径', () => {
    expect(mappingWarning({ path: 'model', values: {} })).toBe('「model」是请求体保留字段，不能映射')
    expect(mappingWarning({ path: 'thinking.type', values: {} }, 'gemini')).toBe('Gemini 的参数需以 generationConfig. 开头')
    expect(mappingWarning({ path: 'reasoning_effort', values: {} }, 'anthropic')).toBe(
      'Anthropic 只认 thinking，请直接映射 thinking 并填完整 JSON 对象'
    )
    expect(mappingWarning({ path: 'thinking', values: {} }, 'anthropic')).toBeNull()
    expect(mappingWarning({ path: 'generationConfig.thinkingConfig.thinkingBudget', values: {} }, 'gemini')).toBeNull()
  })

  it('字段缺失的脏数据不抛错', () => {
    expect(mappingWarning({} as ReasoningMap)).toBeNull()
    expect(mappingWarning({ path: 'x' } as ReasoningMap)).toBeNull()
    expect(mappingWarning({ values: { high: '1' } } as ReasoningMap)).toBe('请先填写官方参数名')
  })
})
