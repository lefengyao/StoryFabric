import { Sparkles } from 'lucide-react'

export function ChatWorkbenchIdentity({ showSessionLength, messageCount, totalChars }: {
  showSessionLength: boolean
  messageCount: number
  totalChars: number
}): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-sm">
        <Sparkles size={15} />
      </span>
      {showSessionLength && messageCount > 0 && (
        <span className="chat-text-meta shrink-0 whitespace-nowrap rounded-md bg-elevated px-2 py-0.5 text-muted">
          {messageCount} 条 · 约{totalChars > 1000 ? `${(totalChars / 1000).toFixed(1)}k` : totalChars} 字
        </span>
      )}
    </div>
  )
}
