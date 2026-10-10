import { describe, expect, it } from 'vitest'
import { parseProseAlternatives } from '../proseAlternatives'

describe('parseProseAlternatives', () => {
  it('extracts explicit candidates without treating a single answer as alternatives', () => {
    expect(parseProseAlternatives('## 方案一：冷峻\n正文一\n\n## 方案二：明快\n正文二')).toEqual([
      { id: 'alternative-1', title: '冷峻', content: '正文一' },
      { id: 'alternative-2', title: '明快', content: '正文二' }
    ])
    expect(parseProseAlternatives('## 方案一\n只有一个候选')).toEqual([])
  })
})
