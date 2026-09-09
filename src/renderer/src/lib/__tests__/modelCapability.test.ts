import { describe, expect, it } from 'vitest'
import {
  addModels,
  filterModels,
  isValidModelName,
  mappingWarning,
  pendingModels,
  removeModel,
  resolveCapability,
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
})
