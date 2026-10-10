import { Bot, ChevronDown, Gauge, RotateCcw, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { OrchestrationPreferences } from '../../../../shared/creative'
import type { AgentBudgetSnapshot, ApprovalPolicy, ModelRef, OrchestrationRunRecord } from '../../../../shared/types'
import { SEVEN_STAGE_TEMPLATE } from '../../../../core/orchestration/templates'
import { BudgetSummary } from './BudgetSummary'

const STAGE_LABEL: Record<string, string> = {
  plan: '计划',
  setting: '设定修改',
  prompt: '提示词优化',
  'anti-ai': '去 AI 味优化',
  write: '正文写作',
  polish: '文后润色',
  review: '审查与建议'
}

const STATUS_LABEL: Record<string, string> = {
  pending: '等待执行',
  running: '进行中',
  waiting_user: '等待确认',
  completed: '已完成',
  skipped: '已跳过',
  failed: '失败',
  cancelled: '已取消',
  stale: '已过期',
  paused_budget: '预算暂停'
}

type StageSnapshot = Pick<OrchestrationRunRecord, 'stages'>

export interface OrchestrationAgentInfo {
  id: string
  label: string
  model: string
  status: string
  kind: 'stage' | 'subagent'
}

export interface OrchestrationPanelModel {
  maxCalls: number
  maxEstimatedTokens: number
  agents: OrchestrationAgentInfo[]
  subagentsEnabled: boolean
}

function statusLabel(status: string | undefined, fallback: string): string {
  return status ? STATUS_LABEL[status] ?? status : fallback
}

export function mergeStageSnapshots(
  persistedStages: OrchestrationRunRecord['stages'] | undefined,
  liveStages: StageSnapshot['stages'] | undefined
): StageSnapshot | undefined {
  const merged = new Map<string, { stageId: string; status: string; reason?: string; artifactId?: string }>()
  for (const stage of persistedStages ?? []) merged.set(stage.stageId, stage)
  for (const stage of liveStages ?? []) {
    const previous = merged.get(stage.stageId)
    merged.set(stage.stageId, { ...previous, ...stage })
  }
  const stages = [...merged.values()]
  return stages.length ? { stages } : undefined
}

export function budgetLimitHint(error: string | undefined): string | null {
  if (!error || !error.includes('模型调用预算不足')) return null
  if (error.includes('调用次数')) return '已达到模型调用次数上限；提高“最大模型调用次数”后再继续。'
  if (error.includes('估计 token')) return '已达到预计 Token 上限；提高“预计 Token 上限”后再继续。'
  return '已达到编排预算上限；请查看调用次数和预计 Token 两项限额。'
}

function modelLabel(model: ModelRef | undefined): string {
  return model?.model?.trim() || '默认对话模型'
}

/** Builds the renderer-facing orchestration summary from the same persisted run/settings data as the executor. */
export function buildOrchestrationPanelModel(
  profile: OrchestrationPreferences,
  defaultModel: ModelRef | undefined,
  snapshot: StageSnapshot | undefined
): OrchestrationPanelModel {
  const statusById = new Map((snapshot?.stages ?? []).map((stage) => [stage.stageId, stage.status]))
  const agents: OrchestrationAgentInfo[] = SEVEN_STAGE_TEMPLATE
    .filter((stage) => profile.enabledStageIds.includes(stage.stageId))
    .map((stage) => ({
      id: stage.stageId,
      label: STAGE_LABEL[stage.stageId] ?? stage.stageId,
      model: modelLabel(profile.modelByStage[stage.stageId] ?? defaultModel),
      status: statusLabel(statusById.get(stage.stageId), '未运行'),
      kind: 'stage'
    }))

  if (profile.subagentsEnabled) {
    agents.push(
      {
        id: 'subagent:continuity',
        label: '连续性核对',
        model: modelLabel(profile.modelByStage.review ?? defaultModel),
        status: statusLabel(statusById.get('subagent:continuity'), '只读协作'),
        kind: 'subagent'
      },
      {
        id: 'subagent:style',
        label: '文风核对',
        model: modelLabel(profile.modelByStage['anti-ai'] ?? defaultModel),
        status: statusLabel(statusById.get('subagent:style'), '只读协作'),
        kind: 'subagent'
      }
    )
  }

  return {
    maxCalls: profile.maxCalls ?? 24,
    maxEstimatedTokens: profile.maxEstimatedTokens ?? 300000,
    agents,
    subagentsEnabled: profile.subagentsEnabled
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(Math.max(0, Math.round(value)))
}

export interface OrchestrationPanelProps {
  profile?: OrchestrationPreferences
  defaultModel?: ModelRef
  running: boolean
  compact?: boolean
  budget?: AgentBudgetSnapshot | null
  run?: OrchestrationRunRecord
  liveStages?: StageSnapshot['stages']
  approvalPolicy?: ApprovalPolicy
  onResume?: () => void
}

export function OrchestrationPanel({ profile, defaultModel, running, compact = false, budget, run, liveStages, approvalPolicy = 'strict', onResume }: OrchestrationPanelProps): React.ReactElement | null {
  const [compactDetailsOpen, setCompactDetailsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(running)
  const compactRef = useRef<HTMLElement | null>(null)
  useEffect(() => { if (running) setDetailsOpen(true) }, [running])
  useEffect(() => {
    if (!compact || !compactDetailsOpen) return
    const close = (): void => setCompactDetailsOpen(false)
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    const onPointerDown = (event: PointerEvent): void => {
      if (compactRef.current && !compactRef.current.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [compact, compactDetailsOpen])
  if (!profile?.enabled) return null
  const snapshot = mergeStageSnapshots(run?.stages, liveStages)
  const model = buildOrchestrationPanelModel(profile, defaultModel, snapshot)
  const effectiveBudget = budget ?? run?.budget ?? null
  const requestCount = run?.requestContexts?.length ?? 0
  const readCount = run?.toolReceipts?.filter((receipt) => receipt.status === 'read').length ?? 0
  const runLabel = running ? '运行中' : run?.status === 'completed' ? '最近一次已完成' : run?.status === 'paused_budget' ? '预算暂停' : run?.status === 'failed' ? '最近一次未完成' : '待运行'
  const currentStage = run?.currentStage ?? snapshot?.stages.find((stage) => stage.status === 'running')?.stageId
  const budgetHint = budgetLimitHint(run?.error)
  const resumable = !running && Boolean(run && ['paused_budget', 'failed', 'cancelled'].includes(run.status))
  const resumeHint = '已完成的阶段会跳过；未完成阶段将从头重试并重新调用模型，已用 Token 仍计入总预算。'
  const approvalLabel: Record<ApprovalPolicy, string> = { strict: '严格审批', 'delete-confirm': '自动执行（删除确认）', auto: '自动执行' }

  if (compact) {
    return (
      <section ref={compactRef} className="min-w-0 rounded-lg border border-line bg-panel px-2.5 py-1.5" aria-label="编排智能体信息">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Bot size={13} /></span>
          <strong className="shrink-0 text-xs font-semibold">编排模式</strong>
          <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">{runLabel}</span>
           <span className="min-w-0 truncate text-[10px] text-faint">{model.agents.length} 个智能体 · {approvalLabel[approvalPolicy]}{currentStage ? ` · 当前：${STAGE_LABEL[currentStage] ?? currentStage}` : ''}</span>
           <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10px] text-muted">调用 {effectiveBudget?.callsStarted ?? requestCount}/{model.maxCalls} · Token {formatTokens(effectiveBudget?.estimatedTokens ?? 0)}/{formatTokens(model.maxEstimatedTokens)}</span>
           {resumable && onResume && <button type="button" title={resumeHint} className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent-soft" onClick={onResume}><RotateCcw size={10} />重试</button>}
         </div>
         {budgetHint && <div className="mt-1 text-[10px] text-danger">{budgetHint}</div>}
        <div className="mt-1 rounded-md border border-line/70 bg-app">
          <button type="button" aria-expanded={compactDetailsOpen} className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left text-[10px] text-muted" onClick={() => setCompactDetailsOpen((open) => !open)}>
            <ChevronDown size={11} className={`shrink-0 transition-transform ${compactDetailsOpen ? 'rotate-180' : ''}`} />
            <span className="min-w-0 flex-1">查看阶段、模型与权限</span>
            <span className="shrink-0 text-faint">所有阶段可读 · 执行者负责写入</span>
          </button>
          {compactDetailsOpen && <div className="grid gap-1 border-t border-line/70 p-1.5 sm:grid-cols-2">
            {model.agents.map((agent) => (
              <div key={agent.id} className="flex min-w-0 items-center gap-1.5 rounded-md border border-line/70 bg-panel px-2 py-1">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${agent.status === '进行中' ? 'animate-pulse bg-accent' : agent.status === '已完成' ? 'bg-ok' : agent.status === '失败' ? 'bg-danger' : 'bg-faint'}`} />
                <span className="min-w-0 flex-1 truncate text-[10px] text-fg">{agent.label}</span>
                <span className="max-w-[7rem] shrink-0 truncate text-[9px] text-faint" title={agent.model}>{agent.model}</span>
                <span className="shrink-0 text-[9px] text-muted">{agent.status}</span>
              </div>
            ))}
          </div>}
        </div>
      </section>
    )
  }

  return (
    <section className="mb-4 rounded-xl border border-line bg-panel p-3" aria-label="编排智能体信息">
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Bot size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <strong className="text-xs font-semibold">编排模式</strong>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">{runLabel}</span>
             <span className="text-[10px] text-faint">{model.agents.length} 个协作智能体 · {approvalLabel[approvalPolicy]}{currentStage ? ` · 当前：${STAGE_LABEL[currentStage] ?? currentStage}` : ''}</span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">所有阶段可读取当前项目资料；正文写入由执行者负责，并遵循当前会话审批。</p>
        </div>
        <span title="总 Token 上限" className="shrink-0 rounded-lg bg-elevated px-2 py-1 text-right">
          <span className="block text-[9px] text-faint">总 Token 上限</span>
          <strong className="font-mono text-xs text-fg">{model.maxEstimatedTokens.toLocaleString()}</strong>
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="min-w-0 rounded-lg bg-app px-2.5 py-2"><span className="block text-[10px] text-faint">模型调用上限</span><strong className="mt-0.5 block text-xs text-fg">{model.maxCalls.toLocaleString()} 次</strong></div>
        <div className="min-w-0 rounded-lg bg-app px-2.5 py-2"><span className="block text-[10px] text-faint">已启动调用</span><strong className="mt-0.5 block text-xs text-fg">{effectiveBudget?.callsStarted ?? requestCount} 次</strong></div>
        <div className="min-w-0 rounded-lg bg-app px-2.5 py-2"><span className="block text-[10px] text-faint">估算已用</span><strong className="mt-0.5 block truncate text-xs text-fg">{formatTokens(effectiveBudget?.estimatedTokens ?? 0)} token</strong></div>
        <div className="min-w-0 rounded-lg bg-app px-2.5 py-2"><span className="block text-[10px] text-faint">实际已用</span><strong className="mt-0.5 block truncate text-xs text-fg">{formatTokens(effectiveBudget?.actualTokens ?? 0)} token</strong></div>
      </div>

      <div className="mt-2"><BudgetSummary maxCalls={model.maxCalls} usedCalls={effectiveBudget?.callsStarted ?? requestCount} maxTokens={model.maxEstimatedTokens} usedTokens={effectiveBudget?.estimatedTokens ?? 0} /></div>

      <details className="mt-3 rounded-lg border border-line bg-app" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-[11px] text-muted">
          <ChevronDown size={13} className="shrink-0" />
          <Users size={13} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">智能体与阶段配置</span>
          <span className="shrink-0 text-[10px] text-faint">{model.agents.filter((agent) => agent.kind === 'stage').length} 阶段 · {model.subagentsEnabled ? '含只读子智能体' : '未启用子智能体'}</span>
        </summary>
        <div className="grid gap-1.5 border-t border-line p-2 sm:grid-cols-2">
          {model.agents.map((agent) => (
            <div key={agent.id} className="flex min-w-0 items-center gap-2 rounded-md border border-line/70 bg-panel px-2 py-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${agent.status === '进行中' ? 'animate-pulse bg-accent' : agent.status === '已完成' ? 'bg-ok' : agent.status === '失败' ? 'bg-danger' : 'bg-faint'}`} />
              <span className="min-w-0 flex-1 truncate text-xs text-fg">{agent.label}</span>
              <span className="max-w-[8rem] shrink-0 truncate text-[10px] text-faint" title={agent.model}>{agent.model}</span>
              <span className="shrink-0 text-[10px] text-muted">{agent.status}</span>
            </div>
          ))}
        </div>
      </details>

      {run && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-faint"><span className="inline-flex items-center gap-1"><Gauge size={11} />最近运行：{effectiveBudget?.callsStarted ?? requestCount} 次调用</span><span>资料读取 {readCount} 次</span><span>阶段产物 {run.artifacts.length} 个</span>{effectiveBudget?.reservedTokens ? <span>预留 {formatTokens(effectiveBudget.reservedTokens)} token</span> : null}</div>}
      {run && (run.error || run.currentStage || run.lastToolReceipt) && <div className={`mt-2 rounded-lg border px-2.5 py-2 text-[10px] leading-5 ${run.status === 'failed' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-gold/30 bg-gold-soft text-muted'}`}>
        {run.currentStage ? <span className="mr-3">当前阶段：{STAGE_LABEL[run.currentStage] ?? run.currentStage}</span> : null}
        {run.error ? <span>{run.errorCode ? `[${run.errorCode}] ` : ''}{run.error}</span> : null}
        {run.lastToolReceipt?.errorCode ? <span className="ml-3">最后工具：{run.lastToolReceipt.toolName} [{run.lastToolReceipt.errorCode}]</span> : null}
        {run.recoverable ? <span className="ml-3">可重新读取资料、修正参数或解决版本冲突后重试。</span> : null}
        {budgetHint ? <span className="ml-3">{budgetHint}</span> : null}
      </div>}
      {resumable && onResume && <div className="mt-2"><button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-accent hover:bg-accent-soft" onClick={onResume}><RotateCcw size={11} />重试未完成阶段</button><p className="mt-1 text-[10px] text-faint">{resumeHint}</p></div>}
    </section>
  )
}
