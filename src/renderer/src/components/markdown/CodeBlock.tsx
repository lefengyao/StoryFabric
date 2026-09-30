import { Children, isValidElement, type ReactNode } from 'react'
import { CopyButton } from '../ui/CopyButton'

function textContent(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join('')
  if (isValidElement<{ children?: ReactNode }>(value)) return textContent(value.props.children)
  return ''
}

export function CodeBlock({ children }: { children?: ReactNode }): React.ReactElement {
  const code = Children.toArray(children).find((child) => isValidElement(child))
  const className = isValidElement<{ className?: string }>(code) ? code.props.className : undefined
  const language = className?.match(/language-(\S+)/)?.[1]
  // react-markdown adds one final newline to a block's code element.
  const text = textContent(children).replace(/\n$/, '')
  return (
    <div className="not-prose my-3 min-w-0 overflow-hidden rounded-lg border border-line bg-elevated">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-line px-3 py-1">
        <span className="min-w-0 truncate text-xs text-muted">{language ?? '文本'}</span>
        <CopyButton text={text} label="复制代码块" />
      </div>
      <pre data-native-text-selection="true" className="chat-selectable-text m-0 max-w-full overflow-x-auto p-3 text-xs leading-relaxed text-fg">{children}</pre>
    </div>
  )
}
