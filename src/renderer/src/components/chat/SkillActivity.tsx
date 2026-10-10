import type { SkillApplicationEvent } from '../../../../shared/agentEvidence'

const labels: Record<SkillApplicationEvent['status'], string> = {
  checked: '已检查',
  matched: '已匹配',
  loaded: '已载入',
  applied: '已应用',
  none: '无匹配',
  failed: '失败'
}

export function SkillActivity({ events }: { events: SkillApplicationEvent[] }): React.ReactElement | null {
  if (!events.length) return null
  const latestByStage = new Map<string, SkillApplicationEvent>()
  for (const event of events) latestByStage.set(event.stageId ?? 'run', event)
  return (
    <details className="mt-3 rounded-lg border border-line bg-app px-2.5 py-2">
      <summary className="cursor-pointer text-[11px] text-muted">Skill 应用记录 · {events.filter((event) => event.status === 'applied').reduce((sum, event) => sum + event.skills.length, 0)} 个已应用</summary>
      <div className="mt-2 space-y-1.5">
        {[...latestByStage.entries()].map(([scope, event]) => (
          <div key={scope} className="rounded border border-line px-2 py-1.5 text-[11px]">
            <div className="flex items-center gap-2"><span className="text-muted">{scope}</span><span className="text-faint">{labels[event.status]}</span></div>
            {event.skills.length > 0 && <div className="mt-1 space-y-0.5 text-faint">{event.skills.map((skill) => <div key={`${skill.packageId}:${skill.skillId}:${skill.version}`}>{skill.packageId}:{skill.skillId} · {skill.version} · {skill.contentHash}</div>)}</div>}
          </div>
        ))}
      </div>
    </details>
  )
}

