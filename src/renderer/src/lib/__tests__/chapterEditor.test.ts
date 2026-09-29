import { describe, expect, it } from 'vitest'
import { applyChapterEnter } from '../chapterEditor'

function pressEnter(text: string, cursor: number): { text: string; cursor: number } | null {
  const result = applyChapterEnter(text, cursor, cursor)
  if (!result) return null
  return {
    text: text.slice(0, result.from) + result.insert + text.slice(result.to),
    cursor: result.cursor
  }
}

describe('chapter editor paragraph formatting', () => {
  it('starts a new indented paragraph with one blank line', () => {
    const result = pressEnter('　　第一段。', '　　第一段。'.length)

    expect(result).toEqual({ text: '　　第一段。\n\n　　', cursor: '　　第一段。\n\n　　'.length })
  })

  it('upgrades an existing single line break without duplicating an indent', () => {
    const text = '　　第一段。\n第二段。'
    const result = pressEnter(text, '　　第一段。'.length)

    expect(result?.text).toBe('　　第一段。\n\n　　第二段。')
    expect(result?.cursor).toBe('　　第一段。\n\n　　'.length)
  })

  it('keeps an already formatted following paragraph unchanged', () => {
    const text = '　　第一段。\n\n　　第二段。'
    const result = pressEnter(text, '　　第一段。'.length)

    expect(result?.text).toBe(text)
    expect(result?.cursor).toBe('　　第一段。\n\n　　'.length)
  })

  it('does not indent a following Markdown heading', () => {
    const text = '　　正文。\n# 小节'
    const result = pressEnter(text, '　　正文。'.length)

    expect(result?.text).toBe('　　正文。\n\n# 小节')
    expect(result?.cursor).toBe('　　正文。\n\n'.length)
  })

  it('does not force prose formatting onto Markdown structure lines', () => {
    const text = '# 小节'

    expect(pressEnter(text, text.length)).toBeNull()
  })

  it('leaves code fence contents to the normal Markdown editor', () => {
    const text = '```text\n代码行\n```'

    expect(pressEnter(text, '```text\n代码行'.length)).toBeNull()
  })

  it('collapses extra blank lines before the next prose paragraph', () => {
    const text = '　　第一段。\n\n\n第二段。'
    const result = pressEnter(text, '　　第一段。'.length)

    expect(result?.text).toBe('　　第一段。\n\n　　第二段。')
  })

  it('does not duplicate an existing ASCII paragraph indent', () => {
    const text = '　　第一段。\n    第二段。'
    const result = pressEnter(text, '　　第一段。'.length)

    expect(result?.text).toBe(text.replace('\n', '\n\n'))
    expect(result?.cursor).toBe('　　第一段。\n\n    '.length)
  })
})
