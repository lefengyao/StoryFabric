import type { RuleApplicationEvent } from '../../../../shared/agentEvidence'

const labels: Record<RuleApplicationEvent['status'], string> = {
  checked: '已检查',
  matched: '已匹配',
  applied: '已应用',
  none: '无匹配',
  failed: '失败'
}

export function RuleActivity({ events }: { events: RuleApplicationEvent[] }): React.ReactElement | null {
  if (!events.length) return null
  const latestByStage = new Map<string, RuleApplicationEvent>()
  for (const event of events) latestByStage.set(event.stageId ?? 'run', event)
  const applied = events.at(-1)?.rules.length ?? 0
  return (
    <details className="mt-3 rounded-lg border border-line bg-app px-2.5 py-2">
      <summary className="cursor-pointer text-[11px] text-muted">规则集应用记录 · {applied} 条</summary>
      <div className="mt-2 space-y-1.5">
        {[...latestByStage.entries()].map(([scope, event]) => (
          <div key={scope} className="rounded border border-line px-2 py-1.5 text-[11px]">
            <div className="flex items-center gap-2"><span className="text-muted">{scope}</span><span className="text-faint">{labels[event.status]}</span><span className="text-faint">冲突 {event.conflicts} · 覆盖 {event.overridden}</span></div>
            {event.rules.length > 0 && <div className="mt-1 space-y-0.5 text-faint">{event.rules.map((rule) => <div key={`${rule.source}:${rule.id}`}>{rule.source} · {rule.target}.{rule.key} · {rule.severity}</div>)}</div>}
          </div>
        ))}
      </div>
    </details>
  )
}
