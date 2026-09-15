import { Check, CircleAlert, Clock3, Loader2, Sparkles, Wrench } from 'lucide-react'
import { cn } from '../../lib/utils'
import { toolArgsPreview, type LiveToolRun } from '../../stores/chatStore'
import type { LiveTurnItem } from '../../stores/chatStore'

export function shouldShowThinking(items: LiveTurnItem[]): boolean {
  const last = items.at(-1)
  return !last || (last.kind === 'tool' && (last.status === 'ok' || last.status === 'error')) || (last.kind === 'stage' && last.status === 'completed')
}

export function ContextUsageMeter({
  usedTokens,
  contextTokens,
  compressing = false,
  compressedMessages,
  compact = false
}: {
  usedTokens: number
  contextTokens: number
  compressing?: boolean
  compressedMessages?: number
  compact?: boolean
}): React.ReactElement {
  const ratio = Math.min(1, usedTokens / Math.max(1, contextTokens))
  const tone = ratio >= 0.9 ? 'bg-danger' : ratio >= 0.72 ? 'bg-gold' : 'bg-accent'
  const title = [
    `上下文约 ${formatTokens(usedTokens)} / ${formatTokens(contextTokens)}`,
    `剩余约 ${formatTokens(Math.max(0, contextTokens - usedTokens))}`,
    compressedMessages ? `已自动压缩较早的 ${compressedMessages} 条消息` : ''
  ].filter(Boolean).join('；')

  return (
    <div className={cn('context-meter', compact ? 'min-w-28' : 'min-w-44')} title={title}>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-muted">{compressing ? '正在压缩上下文' : '上下文'}</span>
        <strong className="font-mono text-[10px] font-medium text-fg">
          {formatTokens(usedTokens)} / {formatTokens(contextTokens)}
        </strong>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated">
        <i className={cn('block h-full rounded-full transition-[width] duration-300', tone)} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
      </div>
      {compressedMessages ? <small className="mt-1 block text-[9px] text-faint">已自动压缩 {compressedMessages} 条较早消息</small> : null}
    </div>
  )
}

function formatTokens(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(Math.max(0, Math.round(value)))
}

export function ThinkingRow({ label = '模型正在思考' }: { label?: string }): React.ReactElement {
  return (
    <div className="agent-thinking-row flex items-center gap-3 py-1.5 text-xs text-muted">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Sparkles size={13} />
      </span>
      <span className="font-medium">{label}</span>
      <span className="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>
  )
}

export function ToolRunRow({
  name,
  argsJson,
  status,
  preview,
  resultText,
  compact = false
}: {
  name: string
  argsJson?: string
  status: LiveToolRun['status']
  preview?: string
  resultText?: string
  compact?: boolean
}): React.ReactElement {
  const config = {
    running: { label: '调用中', icon: <Loader2 size={11} className="animate-spin" />, tone: 'text-accent bg-accent-soft' },
    pending: { label: '等待确认', icon: <Clock3 size={11} />, tone: 'text-gold bg-gold-soft' },
    ok: { label: '已完成', icon: <Check size={11} />, tone: 'text-ok bg-elevated' },
    error: { label: '失败', icon: <CircleAlert size={11} />, tone: 'text-danger bg-danger-soft' }
  }[status]
  const summary = preview || summarizeResult(resultText)
  const detail = resultText?.trim() ? resultText : ''

  return (
    <div className={cn('agent-tool-row border-l-2 border-line py-1 pl-3', status === 'running' && 'border-accent/40', status === 'pending' && 'border-gold/50')}>
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', config.tone)}>
          {config.icon}
        </span>
        <Wrench size={12} className="shrink-0 text-faint" />
        <span className="shrink-0 text-muted">调用工具</span>
        <code className="min-w-0 truncate font-medium text-accent">{name}</code>
        <span className={cn('ml-auto shrink-0 text-[10px]', status === 'error' ? 'text-danger' : status === 'pending' ? 'text-gold' : 'text-faint')}>
          {config.label}
        </span>
      </div>
      {!compact && argsJson && <p className="mt-1 truncate pl-[68px] font-mono text-[10px] text-faint">{toolArgsPreview(argsJson, 96)}</p>}
      {summary && <p className="mt-1 line-clamp-2 pl-[68px] text-[10px] leading-5 text-muted">{summary}</p>}
      {detail && detail.length > 160 && (
        <details className="ml-[68px] mt-1 text-[10px] text-faint">
          <summary className="cursor-pointer select-none hover:text-fg">查看完整结果</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-app p-2 leading-4">{detail.slice(0, 6000)}</pre>
        </details>
      )}
    </div>
  )
}

function summarizeResult(text: string | undefined): string {
  const value = text?.trim()
  if (!value) return ''
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.error === 'string') return parsed.error
    if (Array.isArray(parsed.items)) return `返回 ${parsed.items.length} 项结果`
    if (typeof parsed.count === 'number') return `返回 ${parsed.count} 项结果`
  } catch {
    // Plain text tool results are already suitable for the compact summary.
  }
  return value.split('\n').find(Boolean)?.slice(0, 180) ?? ''
}
