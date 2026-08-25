/** CodeMirror 6 Markdown 编辑器封装 */
import { basicSetup } from 'codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'

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
  className
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // 外部值与编辑器当前内容一致时跳过替换，避免光标跳动
  const externalValue = useRef(value)

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
            if (u.docChanged) {
              externalValue.current = u.state.doc.toString()
              onChangeRef.current(externalValue.current)
            }
          })
        ]
      }),
      parent: hostRef.current
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === externalValue.current) return
    externalValue.current = value
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return (
    <div className={cn('h-full w-full overflow-hidden rounded-lg border border-line bg-panel', className)}>
      <div ref={hostRef} className="h-full" />
    </div>
  )
}
