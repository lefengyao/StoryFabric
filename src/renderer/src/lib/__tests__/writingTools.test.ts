import { describe, expect, it } from 'vitest'
import { EditorState, Transaction } from '@codemirror/state'
import { history, undo, redo } from '@codemirror/commands'
import { formatChapterText, chapterFormatTransaction, findWordMatches, locateWordMatch } from '../writingTools'

describe('chapter typesetting', () => {
  it('normalizes prose indentation and paragraph spacing without changing punctuation', () => {
    expect(formatChapterText(' \n第一段。  \n第二段！\n\n\n  第三段？\n')).toBe('　　第一段。\n\n　　第二段！\n\n　　第三段？')
  })
  it('preserves Markdown structures, nested lists, tables and fenced code verbatim', () => {
    const source = '# 标题\n\n- 条目\n    续行\n> 引文\n| A | B |\n| - | - |\n```js\n  code()  \n\n~~~\n```\n正文'
    expect(formatChapterText(source)).toBe(source.replace('\n正文', '\n\n　　正文'))
  })
  it('does not close a longer fence with a shorter marker, or indent unfinished code', () => {
    const source = '````text\n```\n正文\n\n'
    expect(formatChapterText(source)).toBe(source)
  })
  it('keeps Setext headings and thematic breaks as Markdown blocks', () => {
    const text = '小节标题\n===\n\n正文\n\n---\n下一段'
    expect(formatChapterText(text)).toBe('小节标题\n===\n\n　　正文\n\n---\n\n　　下一段')
  })
  it('is idempotent, handles Windows newlines and empty chapters', () => {
    const result = formatChapterText('  春天\r\n\r\n　　夏天\r\n')
    expect(result).toBe('　　春天\n\n　　夏天')
    expect(formatChapterText(result)).toBe(result)
    expect(formatChapterText(' \n\t')).toBe('')
  })
  it('keeps formatting as a separate undo step and restores the exact original', () => {
    let state = EditorState.create({ doc: '原文\n第二段', extensions: [history()] })
    state = state.update({ changes: { from: 2, insert: '！' }, userEvent: 'input.type' }).state
    const original = state.doc.toString()
    state = state.update(chapterFormatTransaction(state)).state
    expect(state.doc.toString()).toBe('　　原文！\n\n　　第二段')
    const target = { get state() { return state }, dispatch: (tr: Transaction) => { state = tr.state } }
    expect(undo(target)).toBe(true)
    expect(state.doc.toString()).toBe(original)
    expect(redo(target)).toBe(true)
    expect(state.doc.toString()).toBe('　　原文！\n\n　　第二段')
  })
})

describe('quick word navigation', () => {
  it('uses literal matching, including punctuation and whitespace, without regex surprises', () => {
    expect(findWordMatches('A+B，A+B', 'A+B')).toEqual([{ from: 0, to: 3 }, { from: 4, to: 7 }])
    expect(findWordMatches('名字', '')).toEqual([])
  })
  it('starts at the caret, moves forward and backward, and wraps in both directions', () => {
    const matches = findWordMatches('春风春雨春', '春')
    expect(locateWordMatch(matches, { from: 1, to: 1 }, 1)).toBe(1)
    expect(locateWordMatch(matches, matches[1], 1)).toBe(2)
    expect(locateWordMatch(matches, matches[0], -1)).toBe(2)
    expect(locateWordMatch(matches, matches[2], 1)).toBe(0)
    expect(locateWordMatch([], { from: 0, to: 0 }, 1)).toBe(-1)
  })
})
