import { describe, expect, it } from 'vitest'
import { parseToolArguments, validateToolArguments } from '../toolArguments'
import { TOOL_DEFS } from '../registry'

describe('tool argument contract', () => {
  it('rejects malformed JSON, arrays and non-object values', () => {
    expect(() => parseToolArguments('{oops')).toThrow('不是有效 JSON')
    expect(() => parseToolArguments('[]')).toThrow('必须是 JSON 对象')
    expect(() => parseToolArguments('null')).toThrow('必须是 JSON 对象')
    expect(() => parseToolArguments('"text"')).toThrow('必须是 JSON 对象')
    expect(() => parseToolArguments('')).toThrow('不能为空')
  })

  it('accepts an object and validates required fields and nested types', () => {
    expect(parseToolArguments('{"query":"唐小糖"}')).toEqual({ query: '唐小糖' })
    const definition = TOOL_DEFS.find((item) => item.name === 'save_character')
    if (!definition) throw new Error('save_character definition missing')

    expect(() => validateToolArguments(definition, {})).toThrow('缺少必填参数：character')
    expect(() => validateToolArguments(definition, { character: { name: 42 } })).toThrow('character.name必须是 string')
    expect(() => validateToolArguments(definition, { character: { name: '甲', unknown: true } })).toThrow('不接受字段')
  })

  it('enforces enum and numeric bounds', () => {
    const search = TOOL_DEFS.find((item) => item.name === 'search_project')
    if (!search) throw new Error('search_project definition missing')
    expect(() => validateToolArguments(search, { query: '甲', limit: 0 })).toThrow('不能小于 1')
    expect(() => validateToolArguments(search, { query: '甲', limit: 101 })).toThrow('不能大于 100')

    const move = TOOL_DEFS.find((item) => item.name === 'move_chapter')
    if (!move) throw new Error('move_chapter definition missing')
    expect(() => validateToolArguments(move, { chapterId: 'cha_1', box: 'trash' })).toThrow('不在允许值范围内')
  })
})
