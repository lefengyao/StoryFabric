import type { OrchestrationRunRecord } from '../../../../shared/types'
import { Markdown } from '../markdown/Markdown'

export function OrchestrationResults({ runs }: { runs: OrchestrationRunRecord[] }): React.ReactElement | null {
  const run = runs.at(-1)
  if (!run) return null
  const label = run.status === 'completed' ? '已完成' : run.status === 'cancelled' ? '已取消，已保留已生成内容' : '未完成'
  return (
    <section className="mb-4 rounded-xl border border-line bg-panel p-3" aria-label="编排候选产物">
      <div className="flex items-center gap-2">
        <strong className="text-xs font-semibold">编排候选产物</strong>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">{label}</span>
        <span className="ml-auto text-[10px] text-faint">{run.artifacts.length} 个阶段结果</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {run.stages.map((stage) => {
          const artifact = run.artifacts.find((item) => item.id === stage.artifactId)
          return (
            <details key={stage.stageId} className="rounded-lg border border-line bg-app px-2.5 py-2">
              <summary className="cursor-pointer text-xs text-muted">{stage.stageId} · {stage.status === 'completed' ? '已完成' : stage.status}</summary>
              {artifact?.text && <div className="mt-2 border-t border-line pt-2 text-xs"><Markdown text={artifact.text} /></div>}
              {!artifact?.text && stage.reason && <p className="mt-2 text-[11px] text-faint">{stage.reason}</p>}
            </details>
          )
        })}
      </div>
    </section>
  )
}
