import { describe, expect, it } from 'vitest'
import { splitDelimitedText } from '../delimitedInput'

describe('splitDelimitedText', () => {
  it('splits aliases and tags on Chinese or English commas', () => {
    expect(splitDelimitedText('晚晚, 小晚，林同学')).toEqual(['晚晚', '小晚', '林同学'])
  })

  it('keeps spaces inside a value instead of treating every space as a delimiter', () => {
    expect(splitDelimitedText('星 海,旧王朝')).toEqual(['星 海', '旧王朝'])
  })
})
