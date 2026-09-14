/** CodeMirror 6 Markdown 编辑器封装 */
import { basicSetup } from 'codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'
import { externalEditorChange, shouldNotifyEditorChange } from '../../lib/editorChange'

function themeExt(): Extension {
  return EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--fg)' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--faint)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--elevated) 60%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-content': { caretColor: 'var(--accent)', paddingBottom: '40px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--accent-soft)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' }
  })
}

export function MarkdownEditor({
  value,
  onChange,
  className,
  scrollRef,
  documentId,
  onLayoutReady
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  scrollRef?: React.MutableRefObject<HTMLElement | null>
  documentId?: string
  onLayoutReady?: (documentId?: string) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // 外部值与编辑器当前内容一致时跳过替换，避免光标跳动
  const externalValue = useRef(value)
  const onLayoutReadyRef = useRef(onLayoutReady)
  onLayoutReadyRef.current = onLayoutReady

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: externalValue.current,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          markdown({ base: markdownLanguage }),
          themeExt(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (shouldNotifyEditorChange(u.transactions)) {
              externalValue.current = u.state.doc.toString()
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
      if (scrollRef?.current === view.scrollDOM) scrollRef.current = null
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !documentId) return
    view.requestMeasure({ read: () => null, write: () => onLayoutReadyRef.current?.(documentId) })
  }, [documentId])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === externalValue.current) return
    externalValue.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: externalEditorChange.of(true)
    })
  }, [value])

  return (
    <div className={cn('h-full w-full overflow-hidden rounded-lg border border-line bg-panel', className)}>
      <div ref={hostRef} className="h-full" />
    </div>
  )
}
