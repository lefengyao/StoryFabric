import type { RunActivitySummary } from '../../../../shared/types'

export function RunActivityDetails({ activity }: { activity?: RunActivitySummary }): React.ReactElement | null {
  if (!activity) return null
  const toolCount = activity.tools.reduce((sum, tool) => sum + tool.count, 0)
  return (
    <details className="mt-2 rounded-lg border border-line/80 bg-app/70 px-3 py-2 text-[11px] text-muted">
      <summary className="cursor-pointer select-none font-medium hover:text-fg">
        本次调用 · Skill {activity.skills.length} · 工具 {toolCount} · 规则 {activity.rules.length}
      </summary>
      <div className="mt-2 space-y-2 border-t border-line/70 pt-2">
        <section>
          <div className="font-medium text-fg">Skill</div>
          {activity.skills.length ? activity.skills.map((skill) => (
            <div key={`${skill.packageId}:${skill.skillId}:${skill.version}`} className="mt-1 break-all">
              {skill.packageId}:{skill.skillId} · v{skill.version}
              {skill.stages.length > 0 && <span className="text-faint"> · {skill.stages.join('、')}</span>}
            </div>
          )) : <div className="mt-1 text-faint">未调用</div>}
        </section>
        <section>
          <div className="font-medium text-fg">工具</div>
          {activity.tools.length ? activity.tools.map((tool) => (
            <div key={tool.name} className="mt-1 break-all">{tool.name} · {tool.count} 次{tool.failed > 0 ? ` · 失败 ${tool.failed} 次` : ''}</div>
          )) : <div className="mt-1 text-faint">未调用</div>}
        </section>
        <section>
          <div className="font-medium text-fg">规则</div>
          {activity.rules.length ? activity.rules.map((rule) => (
            <div key={`${rule.source}:${rule.id}:${rule.target}:${rule.key}`} className="mt-1 break-all">{rule.source} · {rule.target}.{rule.key} · {rule.id}</div>
          )) : <div className="mt-1 text-faint">未应用</div>}
        </section>
      </div>
    </details>
  )
}
