import type { OrchestrationRunRecord } from '../../../../shared/types'
import { Markdown } from '../markdown/Markdown'
import { SkillActivity } from './SkillActivity'
import { RuleActivity } from './RuleActivity'

export function OrchestrationResults({ runs }: { runs: OrchestrationRunRecord[] }): React.ReactElement | null {
  const run = runs.at(-1)
  if (!run) return null
  const label = run.status === 'completed' ? '已完成' : run.status === 'cancelled' ? '已取消，已保留已生成内容' : run.status === 'paused_budget' ? '预算暂停，可继续' : '未完成'
  return (
    <section className="mb-4 rounded-xl border border-line bg-panel p-3" aria-label="编排候选产物">
      <div className="flex min-w-0 items-center gap-2">
        <strong className="min-w-0 flex-1 truncate text-xs font-semibold">编排候选产物</strong>
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">{label}</span>
        <span className="shrink-0 whitespace-nowrap text-[10px] text-faint">{run.artifacts.length} 个阶段结果 · {run.toolReceipts?.filter((receipt) => receipt.status === 'read').length ?? 0} 次实际读取 · {run.requestContexts?.length ?? 0} 次请求</span>
      </div>
      {(run.error || run.recoverable || run.lastToolReceipt?.errorCode) && <div className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] leading-5 ${run.status === 'failed' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-gold/30 bg-gold-soft text-muted'}`}>
        {run.currentStage ? <span className="mr-3">当前阶段：{run.currentStage}</span> : null}
        {run.errorCode ? <span className="mr-1 font-mono">[{run.errorCode}]</span> : null}
        {run.error ?? (run.lastToolReceipt?.errorCode ? `最后工具 ${run.lastToolReceipt.toolName} 返回 ${run.lastToolReceipt.errorCode}` : '运行未完成')}
        {run.recoverable ? <span className="ml-2">可重新读取资料、修正参数或解决版本冲突后重试。</span> : null}
      </div>}
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
      <SkillActivity events={run.skillEvents ?? []} />
      <RuleActivity events={run.ruleEvents ?? []} />
      {(run.toolReceipts?.length ?? 0) > 0 && <details className="mt-3 rounded-lg border border-line bg-app px-2.5 py-2">
        <summary className="cursor-pointer text-[11px] text-muted">资料读取回执 · {run.toolReceipts?.length} 条</summary>
        <div className="mt-2 space-y-1 text-[11px] text-faint">{run.toolReceipts?.map((receipt) => <div key={receipt.callId}>{receipt.stageId} · {receipt.toolName} · {receipt.status}{receipt.sources.length ? ` · ${receipt.sources.length} 个来源` : ''}</div>)}</div>
      </details>}
    </section>
  )
}
