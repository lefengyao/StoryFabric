import { useMemo, useState } from 'react'
import type { PlatformCapabilities } from '../../../../shared/platformCapabilities'
import type { StageId } from '../../../../core/orchestration/types'
import { SEVEN_STAGE_TEMPLATE } from '../../../../core/orchestration/templates'
import { BudgetSummary } from './BudgetSummary'
import { orchestrationStartEnabled } from './orchestrationPolicy'
import type { AgentBudgetSnapshot } from '../../../../shared/types'

export interface OrchestrationPanelProps { capabilities?: PlatformCapabilities; running: boolean; onStart: (stageIds: StageId[]) => void; onStop: () => void; maxCalls?: number; maxTokens?: number; budget?: AgentBudgetSnapshot | null }

export function OrchestrationPanel({ capabilities, running, onStart, onStop, maxCalls = 24, maxTokens = 100000, budget }: OrchestrationPanelProps): React.ReactElement {
  const [selected, setSelected] = useState<StageId[]>(SEVEN_STAGE_TEMPLATE.map((stage) => stage.stageId))
  const canStart = useMemo(() => orchestrationStartEnabled(capabilities, running), [capabilities, running])
  return <section className="rounded-xl border border-line bg-panel p-3" aria-label="智能体编排"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">七阶段编排</h2><p className="mt-1 text-[11px] text-muted">多阶段会调用更多模型；已选 {selected.length} 个，启动前请确认预算。</p></div>{running ? <button type="button" onClick={onStop} className="rounded-lg bg-danger-soft px-3 py-1.5 text-xs text-danger">停止</button> : <button type="button" disabled={!canStart || selected.length === 0} onClick={() => onStart(selected)} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-fg disabled:opacity-50">开始编排</button>}</div><div className="mt-3 grid grid-cols-2 gap-1.5">{SEVEN_STAGE_TEMPLATE.map((stage) => <label key={stage.stageId} className="flex items-center gap-2 rounded-md bg-app px-2 py-1.5 text-xs"><input type="checkbox" checked={selected.includes(stage.stageId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, stage.stageId] : current.filter((id) => id !== stage.stageId))} />{stage.stageId}</label>)}</div><div className="mt-3"><BudgetSummary maxCalls={budget?.maxCalls ?? maxCalls} usedCalls={budget?.callsStarted ?? 0} maxTokens={budget?.maxEstimatedTokens ?? maxTokens} usedTokens={budget?.estimatedTokens ?? 0} /></div></section>
}
