import { describe, expect, it } from 'vitest'
import { formatTokens, modelParamOptions } from '../modelParamOptions'

describe('formatTokens', () => {
  it('按 K/M 格式化', () => {
    expect(formatTokens(4096)).toBe('4K')
    expect(formatTokens(131072)).toBe('128K')
    expect(formatTokens(278528)).toBe('272K')
    expect(formatTokens(1048576)).toBe('1M')
    expect(formatTokens(64000)).toBe('63K')
  })

  it('非法值显示占位符', () => {
    expect(formatTokens(0)).toBe('—')
    expect(formatTokens(Number.NaN)).toBe('—')
  })
})

describe('modelParamOptions', () => {
  it('预设与档案默认值合并去重并升序', () => {
    expect(modelParamOptions([32768, 131072], 64000)).toEqual([32768, 64000, 131072])
  })

  it('档案值已在预设中时不重复', () => {
    expect(modelParamOptions([4096, 8192], 8192)).toEqual([4096, 8192])
  })

  it('保留 JSON 导入的自定义数值供表单继续编辑', () => {
    expect(modelParamOptions([4096, 8192], 8192, 6000)).toEqual([4096, 6000, 8192])
  })
})
