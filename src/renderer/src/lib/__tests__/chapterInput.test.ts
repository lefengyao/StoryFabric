import { EditorState, Transaction } from '@codemirror/state'
import { history, undo, redo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { chapterInputFormatting } from '../chapterEditor'
import { externalEditorChange } from '../editorChange'

function editor(doc = ''): EditorState {
  return EditorState.create({ doc, extensions: [history(), chapterInputFormatting] })
}

function type(state: EditorState, insert: string, from = state.doc.length, to = from, event = 'input.type'): EditorState {
  return state.update({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: event }).state
}

describe('chapter first-character indentation', () => {
  it('indents the first typed character and keeps the cursor after it', () => {
    const state = type(editor(), '春')
    expect(state.doc.toString()).toBe('　　春')
    expect(state.selection.main.head).toBe(3)
    expect(type(state, '天').doc.toString()).toBe('　　春天')
  })

  it('keeps the IME preedit text untouched until the composition is committed', () => {
    let state = type(editor(), 'c', 0, 0, 'input.type.compose')
    expect(state.doc.toString()).toBe('c')
    state = type(state, '春', 0, 1, 'input.type.compose')
    expect(state.doc.toString()).toBe('春')
    expect(state.selection.main.head).toBe(1)
  })

  it('indents a blank paragraph reached with a mobile line break', () => {
    const state = type(editor('　　第一段。\n\n'), '新')
    expect(state.doc.toString()).toBe('　　第一段。\n\n　　新')
  })

  it('does not alter existing prose or duplicate a manual indent', () => {
    expect(type(editor('　　'), '春').doc.toString()).toBe('　　春')
    expect(type(editor('    '), '春').doc.toString()).toBe('    春')
    expect(type(editor('旧正文'), '新', 0).doc.toString()).toBe('新旧正文')
  })

  it.each(['#', '>', '-', '*', '`', '~', '|'])('keeps a Markdown opener %s at column one', (insert) => {
    expect(type(editor(), insert).doc.toString()).toBe(insert)
  })

  it('leaves fenced code, pasted content and external loads unchanged', () => {
    expect(type(editor('```text\n'), '代码').doc.toString()).toBe('```text\n代码')
    expect(type(editor(), '粘贴内容', 0, 0, 'input.paste').doc.toString()).toBe('粘贴内容')
    const loaded = editor().update({ changes: { from: 0, insert: '外部正文' }, userEvent: 'input.type', annotations: externalEditorChange.of(true) }).state
    expect(loaded.doc.toString()).toBe('外部正文')
  })

  it.each([
    '```js\n~~~\n',
    '````js\n```\n'
  ])('does not indent code after a non-matching fence: %j', (prefix) => {
    expect(type(editor(prefix), '代码').doc.toString()).toBe(prefix + '代码')
  })

  it('undoes and redoes the first character together with its indent', () => {
    let state = type(editor(), '春')
    const target = { get state() { return state }, dispatch: (tr: Transaction) => { state = tr.state } }
    expect(undo(target)).toBe(true)
    expect(state.doc.toString()).toBe('')
    expect(redo(target)).toBe(true)
    expect(state.doc.toString()).toBe('　　春')
  })
})
