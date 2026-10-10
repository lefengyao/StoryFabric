import type { RunEventEnvelope } from '../../../../shared/agentRuntime'

function eventLabel(event: RunEventEnvelope): { text: string; tone: string } {
  const payload = event.event.payload as { message?: string; code?: string; recoverable?: boolean; reason?: string; name?: string } | undefined
  switch (event.event.type) {
    case 'run-error':
      return { text: `失败${payload?.code ? ` [${payload.code}]` : ''}：${payload?.message ?? '运行失败'}${payload?.recoverable ? '（可重试）' : ''}`, tone: 'text-danger' }
    case 'run-paused':
      return { text: `已暂停：${payload?.message ?? payload?.reason ?? '等待恢复'}`, tone: 'text-gold' }
    case 'stage-start': return { text: `阶段开始：${event.stageId ?? '未命名'}`, tone: 'text-accent' }
    case 'stage-complete': return { text: `阶段完成：${event.stageId ?? '未命名'}`, tone: 'text-ok' }
    case 'tool-generating': return { text: `工具调用：${payload?.name ?? '工具'}`, tone: 'text-muted' }
    case 'tool-complete': return { text: `工具完成${payload?.code ? ` [${payload.code}]` : ''}`, tone: 'text-muted' }
    case 'waiting-user': return { text: '等待用户确认', tone: 'text-gold' }
    default: return { text: event.event.type, tone: 'text-muted' }
  }
}

export function RunTimeline({ events }: { events: RunEventEnvelope[] }): React.ReactElement {
  return <ol className="space-y-1 text-xs text-muted">{events.map((event) => {
    const label = eventLabel(event)
    return <li key={`${event.runId}:${event.seq}`} className="flex min-w-0 gap-2"><span className="shrink-0 font-mono text-faint">{event.seq}</span><span className={`min-w-0 flex-1 truncate ${label.tone}`} title={label.text}>{event.stageId ?? event.agentId} · {label.text}</span></li>
  })}</ol>
}
