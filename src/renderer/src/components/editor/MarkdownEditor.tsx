/** CodeMirror 6 Markdown 编辑器封装 */
import { basicSetup } from 'codemirror'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab, redo, selectAll, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { openSearchPanel, search, SearchQuery, setSearchQuery } from '@codemirror/search'
import type React from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { cn } from '../../lib/utils'
import { externalEditorChange, shouldNotifyEditorChange } from '../../lib/editorChange'
import { shouldFocusEditorOnDocumentSwitch } from '../../lib/documentSwitch'
import { applyChapterEnter, chapterInputFormatting } from '../../lib/chapterEditor'
import { afterChapterComposition, chapterCompositionFormatting, chapterPendingInput, insertChapterText } from './chapterComposition'
import { chapterFormatTransaction, findWordMatches, locateWordMatch, type WordMatch } from '../../lib/writingTools'

function themeExt(): Extension {
  return EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--fg)' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--faint)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--elevated) 60%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-content': { caretColor: 'var(--accent)', paddingBottom: '40px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--accent-soft)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-content ::selection, .cm-content::selection': { color: 'var(--fg)', backgroundColor: 'var(--accent-soft)' },
    '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' }
  })
}

export interface MarkdownEditorHandle {
  openSearch: () => void
  undo: () => void
  redo: () => void
  selectAll: () => void
  locateWord: (word: string, direction?: 1 | -1) => void
  clearWord: () => void
  format: () => 'formatted' | 'queued' | 'unchanged'
  insertText: (text: string) => void
}

function chapterEnter(view: EditorView): boolean {
  const selection = view.state.selection.main
  const change = applyChapterEnter(view.state.doc.toString(), selection.from, selection.to)
  if (!change) return false
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.cursor }
  })
  return true
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  value: string
  onChange: (v: string) => void
  className?: string
  scrollRef?: React.MutableRefObject<HTMLElement | null>
  documentId?: string
  onLayoutReady?: (documentId?: string) => void
  chapterFormatting?: boolean
  onSelectionChange?: (selection: WordMatch) => void
  onFocusChange?: (focused: boolean) => void
  onPendingInputChange?: (text: string) => void
}>(function MarkdownEditor({
  value,
  onChange,
  className,
  scrollRef,
  documentId,
  onLayoutReady,
  chapterFormatting = false,
  onSelectionChange,
  onFocusChange,
  onPendingInputChange
}, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  useImperativeHandle(ref, () => ({
    openSearch: () => { const view = viewRef.current; if (view) openSearchPanel(view) },
    undo: () => { const view = viewRef.current; if (view) { undo(view); view.focus() } },
    redo: () => { const view = viewRef.current; if (view) { redo(view); view.focus() } },
    selectAll: () => { const view = viewRef.current; if (view) { selectAll(view); view.focus() } },
    locateWord: (word, direction = 1) => {
      const view = viewRef.current
      if (!view) return
      afterChapterComposition(view, () => {
        const matches = findWordMatches(view.state.doc.toString(), word)
        const index = locateWordMatch(matches, view.state.selection.main, direction)
        view.dispatch({
          effects: setSearchQuery.of(new SearchQuery({ search: word, caseSensitive: true, regexp: false })),
          ...(index < 0 ? {} : { selection: { anchor: matches[index].from, head: matches[index].to }, scrollIntoView: true })
        })
        if (index >= 0) view.focus()
      })
    },
    clearWord: () => { viewRef.current?.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) }) },
    format: () => {
      const view = viewRef.current
      if (!view) return 'unchanged'
      let changed = false
      const queued = afterChapterComposition(view, () => {
        const transaction = chapterFormatTransaction(view.state)
        if (!transaction.changes) return
        changed = true
        view.dispatch(transaction)
        view.focus()
      })
      return queued ? 'queued' : changed ? 'formatted' : 'unchanged'
    },
    insertText: (text) => {
      const view = viewRef.current
      if (!view || !text) return
      insertChapterText(view, text)
    }
  }), [])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSelectionRef = useRef(onSelectionChange)
  onSelectionRef.current = onSelectionChange
  const onFocusRef = useRef(onFocusChange)
  onFocusRef.current = onFocusChange
  const onPendingInputRef = useRef(onPendingInputChange)
  onPendingInputRef.current = onPendingInputChange
  // 外部值与编辑器当前内容一致时跳过替换，避免光标跳动
  const externalValue = useRef(value)
  // React can acknowledge an earlier IME preedit after CodeMirror has committed
  // the candidate. Recognize those local echoes instead of replacing the document.
  const localValueEchoes = useRef<string[]>([])
  const valueDocumentId = useRef(documentId)
  const previousDocumentId = useRef(documentId)
  const onLayoutReadyRef = useRef(onLayoutReady)
  onLayoutReadyRef.current = onLayoutReady

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: externalValue.current,
        extensions: [
          basicSetup,
          search(),
          ...(chapterFormatting ? [chapterInputFormatting, chapterCompositionFormatting, chapterPendingInput.of((text) => onPendingInputRef.current?.(text)), Prec.highest(keymap.of([{ key: 'Enter', run: chapterEnter }]))] : []),
          keymap.of([indentWithTab]),
          markdown({ base: markdownLanguage }),
          themeExt(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) onSelectionRef.current?.({ from: u.state.selection.main.from, to: u.state.selection.main.to })
            if (u.focusChanged) onFocusRef.current?.(u.view.hasFocus)
            if (shouldNotifyEditorChange(u.transactions)) {
              externalValue.current = u.state.doc.toString()
              localValueEchoes.current.push(externalValue.current)
              onChangeRef.current(externalValue.current)
            }
          })
        ]
      }),
      parent: hostRef.current
    })
    viewRef.current = view
    if (scrollRef) scrollRef.current = view.scrollDOM
    view.requestMeasure({ read: () => null, write: () => onLayoutReadyRef.current?.(documentId) })
    return () => {
      view.destroy()
      onFocusRef.current?.(false)
      if (scrollRef?.current === view.scrollDOM) scrollRef.current = null
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const switchedDocument = valueDocumentId.current !== documentId
    valueDocumentId.current = documentId
    if (switchedDocument) localValueEchoes.current = []
    else {
      const echo = localValueEchoes.current.lastIndexOf(value)
      if (echo >= 0) { localValueEchoes.current.splice(0, echo + 1); return }
    }
    if (switchedDocument && value === externalValue.current) {
      view.dispatch({ annotations: externalEditorChange.of(true) })
      return
    }
    if (value === externalValue.current) return
    localValueEchoes.current = []
    externalValue.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: externalEditorChange.of(true)
    })
  }, [value, documentId])

  useEffect(() => {
    const view = viewRef.current
    const previousId = previousDocumentId.current
    previousDocumentId.current = documentId
    if (!view || !documentId) return
    view.requestMeasure({ read: () => null, write: () => onLayoutReadyRef.current?.(documentId) })
    if (shouldFocusEditorOnDocumentSwitch(previousId, documentId)) view.focus()
  }, [documentId])

  return (
    <div className={cn('h-full w-full overflow-hidden rounded-lg border border-line bg-panel', className)}>
      <div ref={hostRef} className="h-full" />
    </div>
  )
})
