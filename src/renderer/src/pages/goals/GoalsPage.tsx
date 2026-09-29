import { CircleCheck, CirclePause, ListChecks, Play, RefreshCw, Square, Target } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { GoalRun, GoalStatus } from '../../../../shared/types'
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { formatTime } from '../../lib/utils'

const STATUS_LABEL: Record<GoalStatus, string> = {
  planning: '规划中', running: '执行中', 'awaiting-approval': '等待审批', validating: '验收中', completed: '已完成', 'needs-attention': '需要处理', cancelled: '已停止'
}

function statusTone(status: GoalStatus): 'accent' | 'ok' | 'danger' | 'default' {
  if (status === 'completed') return 'ok'
  if (status === 'needs-attention') return 'danger'
  if (status === 'running' || status === 'planning' || status === 'validating' || status === 'awaiting-approval') return 'accent'
  return 'default'
}

export function GoalsPage(): React.ReactElement {
  const [goals, setGoals] = useState<GoalRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try { setGoals(await api.listGoals()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const action = async (id: string, kind: 'continue' | 'stop' | 'replan'): Promise<void> => {
    setBusyId(id); setError(null)
    try {
      if (kind === 'continue') await api.continueGoal(id)
      else if (kind === 'stop') await api.stopGoal(id)
      else await api.replanGoal(id)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusyId(null) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Target size={17} /></span>
          <div><h2 className="text-sm font-semibold">目标中心</h2><p className="text-[11px] text-muted">目标模式会自动拆分任务并持续执行，可能消耗更多额度。</p></div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} title="刷新目标"><RefreshCw size={14} /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {error && <div className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
        {loading ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : goals.length === 0 ? <EmptyState icon={<ListChecks size={30} />} title="还没有目标运行" hint="在智能体工作台选择“目标模式”发送任务后，目标会出现在这里。" /> : (
          <div className="mx-auto max-w-4xl space-y-3">
            {goals.map((goal) => {
              const busy = busyId === goal.id
              const canContinue = goal.status === 'cancelled' || goal.status === 'needs-attention' || goal.status === 'awaiting-approval'
              return (
                <Card key={goal.id} className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{goal.goal}</h3><Badge tone={statusTone(goal.status)}>{STATUS_LABEL[goal.status]}</Badge><span className="text-[10px] text-faint">计划 v{goal.planVersion} · {formatTime(goal.updatedAt)}</span></div>{goal.needsAttentionReason && <p className="mt-1 text-xs text-danger">{goal.needsAttentionReason}</p>}</div>
                    <div className="flex shrink-0 items-center gap-1">
                      {canContinue && <Button size="sm" variant="primary" onClick={() => void action(goal.id, 'continue')} disabled={busy}><Play size={12} /> 继续</Button>}
                      {(goal.status === 'running' || goal.status === 'planning' || goal.status === 'awaiting-approval' || goal.status === 'validating') && <Button size="sm" variant="outline" onClick={() => void action(goal.id, 'stop')} disabled={busy} title="停止目标"><Square size={12} /></Button>}
                      {goal.status !== 'completed' && <Button size="sm" variant="ghost" onClick={() => void action(goal.id, 'replan')} disabled={busy} title="重新规划"><RefreshCw size={12} /></Button>}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {goal.tasks.map((task) => <div key={task.id} className="flex min-w-0 items-center gap-2 rounded-md bg-elevated px-2.5 py-2 text-xs"><span className="shrink-0 text-muted">{task.status === 'completed' ? <CircleCheck size={13} className="text-ok" /> : task.status === 'pending' ? <CirclePause size={13} /> : <Play size={13} className="text-accent" />}</span><span className="min-w-0 flex-1 truncate">{task.title}</span><span className="shrink-0 text-[10px] text-faint">{task.attempts} 次</span></div>)}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
