import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { externalEditorChange, shouldNotifyEditorChange } from '../editorChange'

describe('editor change notifications', () => {
  it('does not mark a document dirty when React loads a new value into CodeMirror', () => {
    const state = EditorState.create({ doc: '旧章节内容' })
    const update = state.update({
      changes: { from: 0, to: state.doc.length, insert: '新章节内容' },
      annotations: externalEditorChange.of(true)
    })

    expect(shouldNotifyEditorChange([update])).toBe(false)
  })

  it('notifies the owner for a real editor edit', () => {
    const state = EditorState.create({ doc: '章节内容' })
    const update = state.update({ changes: { from: state.doc.length, insert: '。' } })

    expect(shouldNotifyEditorChange([update])).toBe(true)
  })
})
