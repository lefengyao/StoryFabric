import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { copyPlainText } from '../../lib/clipboard'
import { Button } from './primitives'

export function CopyButton({ text, label = '复制', className }: { text: string; label?: string; className?: string }): React.ReactElement {
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copied = copiedText === text

  useEffect(() => {
    setCopiedText(null)
    setError(null)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [text])

  const copy = async (): Promise<void> => {
    setCopying(true)
    setError(null)
    try {
      await copyPlainText(text)
      setCopiedText(text)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopiedText(null), 2000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '复制失败，请重试')
    } finally {
      setCopying(false)
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      <Button type="button" size="sm" variant="ghost" className={className} onClick={() => void copy()} disabled={!text || copying} aria-label={label} title={label}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span aria-live="polite">{copied ? '已复制' : '复制'}</span>
      </Button>
      {error && <span role="alert" className="break-words text-xs text-danger">{error}</span>}
    </span>
  )
}
