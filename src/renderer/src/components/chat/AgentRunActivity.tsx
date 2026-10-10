import { Check, ChevronDown, ChevronUp, CircleAlert, Clock3, Loader2, Wrench } from 'lucide-react'
import { memo, useId, useMemo, useState } from 'react'
import type { RuleApplicationEvent, SkillApplicationEvent } from '../../../../shared/agentEvidence'
import type { RunActivitySummary } from '../../../../shared/types'
import type { LiveTurnItem } from '../../stores/chatStore'
import { agentStageLabel } from '../../lib/agentStagePresentation'
import { cn } from '../../lib/utils'
import { shouldShowThinking, ThinkingRow, ToolRunRow } from './AgentActivity'
import type { ActivityTool } from './chatActivityGroups'

interface AgentRunActivityProps {
  tools?: ActivityTool[]
  timeline?: LiveTurnItem[]
  skillEvents?: SkillApplicationEvent[]
  ruleEvents?: RuleApplicationEvent[]
  activity?: RunActivitySummary
  running?: boolean
  failed?: boolean
  thinkingLabel?: string
  compact?: boolean
}

const EMPTY_TIMELINE: LiveTurnItem[] = []
const EMPTY_SKILLS: SkillApplicationEvent[] = []
const EMPTY_RULES: RuleApplicationEvent[] = []
const SKILL_STATUS: Record<SkillApplicationEvent['status'], string> = { checked: '已检查', matched: '已匹配', loaded: '已载入', applied: '已应用', none: '无匹配', failed: '失败' }
const RULE_STATUS: Record<RuleApplicationEvent['status'], string> = { checked: '已检查', matched: '已匹配', applied: '已应用', none: '无匹配', failed: '失败' }

function AgentRunActivityInner({ tools, timeline = EMPTY_TIMELINE, skillEvents = EMPTY_SKILLS, ruleEvents = EMPTY_RULES, activity, running = false, failed = false, thinkingLabel, compact = false }: AgentRunActivityProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const liveTools = useMemo(() => timeline.filter((item): item is Extract<LiveTurnItem, { kind: 'tool' }> => item.kind === 'tool'), [timeline])
  const stages = useMemo(() => timeline.filter((item): item is Extract<LiveTurnItem, { kind: 'stage' }> => item.kind === 'stage'), [timeline])
  const rows = tools ?? liveTools
  const toolCount = Math.max(rows.length, activity?.tools.reduce((sum, tool) => sum + tool.count, 0) ?? 0)
  const failedTools = Math.max(rows.filter((tool) => tool.status === 'error').length, activity?.tools.reduce((sum, tool) => sum + tool.failed, 0) ?? 0)
  const hasFailure = failed || failedTools > 0 || stages.some((stage) => stage.status === 'failed') || skillEvents.some((event) => event.status === 'failed') || ruleEvents.some((event) => event.status === 'failed')
  const pending = rows.some((tool) => tool.status === 'pending')
  const incomplete = rows.some((tool) => tool.status === 'running' || tool.status === 'pending') || stages.some((stage) => stage.status === 'running')
  const currentTool = [...rows].reverse().find((tool) => tool.status === 'running' || tool.status === 'pending')
  const currentStage = [...stages].reverse().find((stage) => stage.status === 'running')
  const skillCount = Math.max(activity?.skills.length ?? 0, new Set(skillEvents.flatMap((event) => event.skills.map((skill) => `${skill.packageId}:${skill.skillId}:${skill.version}`))).size)
  const ruleCount = Math.max(activity?.rules.length ?? 0, new Set(ruleEvents.flatMap((event) => event.rules.map((rule) => `${rule.source}:${rule.id}:${rule.target}:${rule.key}`))).size)
  const hasRecords = toolCount > 0 || stages.length > 0 || skillEvents.length > 0 || ruleEvents.length > 0 || skillCount > 0 || ruleCount > 0
  if (!hasRecords && !running) return null

  const status = pending && running ? '等待确认' : running ? '进行中' : hasFailure ? '有失败' : incomplete ? '未完成' : '已完成'
  const Icon = pending && running ? Clock3 : running ? Loader2 : hasFailure ? CircleAlert : incomplete ? Clock3 : Check
  const currentLabel = currentTool?.name ?? (currentStage ? agentStageLabel(currentStage.stageId) : running ? thinkingLabel : undefined)

  return (
    <section data-agent-run-activity className={cn('min-w-0 rounded-lg border border-line bg-panel', hasFailure && 'border-danger/40')} aria-label="运行活动">
      <button type="button" aria-label={expanded ? '收起运行详情' : '展开运行详情'} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)} className={cn('flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent', compact && 'px-2.5')}>
        <Icon size={14} aria-hidden="true" className={cn('shrink-0', running && !pending ? 'animate-spin text-accent' : hasFailure ? 'text-danger' : pending || incomplete ? 'text-gold' : 'text-ok')} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="font-medium text-fg">运行活动</strong>
            <span className="text-muted">工具 {toolCount}</span>
            {skillCount > 0 && <span className="text-muted">技能 {skillCount}</span>}
            {ruleCount > 0 && <span className="text-muted">规则 {ruleCount}</span>}
            {failedTools > 0 && <span className="text-danger">失败 {failedTools}</span>}
            {hasFailure && failedTools === 0 && <span className="text-danger">有失败</span>}
          </span>
          {currentLabel && <span className="mt-1 block truncate text-[11px] text-muted" title={currentLabel}>{currentLabel.slice(0, 180)}</span>}
        </span>
        <span className={cn('shrink-0 text-[11px]', hasFailure ? 'text-danger' : 'text-muted')}>{status}</span>
        {expanded ? <ChevronUp size={16} aria-hidden="true" className="shrink-0 text-muted" /> : <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted" />}
      </button>
      {expanded && <div id={detailsId} data-agent-run-details className="max-h-80 overflow-y-auto overscroll-contain border-t border-line px-3 py-3 text-[11px] text-muted">
        <div className="space-y-3">
          {rows.map((tool, index) => <ToolRunRow key={`${tool.callId}:${index}`} {...tool} compact={compact} />)}
          {stages.map((stage) => <div key={stage.id} className="flex min-w-0 items-start justify-between gap-3"><span className="min-w-0 break-words">{agentStageLabel(stage.stageId)}</span><span className={cn('shrink-0', stage.status === 'failed' && 'text-danger')}>{stage.status === 'running' ? '进行中' : stage.status === 'completed' ? '已完成' : '失败'}</span></div>)}
          {activity?.tools.length ? <div className="space-y-1 border-t border-line pt-2">{activity.tools.map((tool) => <div key={tool.name} className="flex min-w-0 items-start gap-2"><Wrench size={12} className="mt-0.5 shrink-0" /><span className="min-w-0 break-all">{tool.name} · {tool.count} 次{tool.failed > 0 ? ` · 失败 ${tool.failed} 次` : ''}</span></div>)}</div> : null}
          {activity?.skills.map((skill) => <div key={`${skill.packageId}:${skill.skillId}:${skill.version}`} className="break-all">技能 · {skill.packageId}:{skill.skillId} · v{skill.version}{skill.stages.length > 0 ? ` · ${skill.stages.join('、')}` : ''}</div>)}
          {skillEvents.map((event, index) => <div key={`${event.runId}:${event.stageId}:${index}`} className="break-all"><span className={event.status === 'failed' ? 'text-danger' : undefined}>技能 · {event.stageId ? agentStageLabel(event.stageId) : '本轮'} · {SKILL_STATUS[event.status]}</span>{event.skills.map((skill) => <div key={`${skill.packageId}:${skill.skillId}:${skill.version}`} className="mt-1 text-faint">{skill.packageId}:{skill.skillId} · {skill.version} · {skill.contentHash}</div>)}</div>)}
          {activity?.rules.map((rule) => <div key={`${rule.source}:${rule.id}:${rule.target}:${rule.key}`} className="break-all">规则 · {rule.source} · {rule.target}.{rule.key} · {rule.id}</div>)}
          {ruleEvents.map((event, index) => <div key={`${event.runId}:${event.stageId}:${index}`} className="break-all"><span className={event.status === 'failed' ? 'text-danger' : undefined}>规则 · {event.stageId ? agentStageLabel(event.stageId) : '本轮'} · {RULE_STATUS[event.status]} · 冲突 {event.conflicts} · 覆盖 {event.overridden}</span>{event.rules.map((rule) => <div key={`${rule.source}:${rule.id}`} className="mt-1 text-faint">{rule.source} · {rule.target}.{rule.key} · {rule.severity}</div>)}</div>)}
          {running && shouldShowThinking(timeline) && <ThinkingRow label={thinkingLabel} />}
        </div>
      </div>}
    </section>
  )
}

export const AgentRunActivity = memo(AgentRunActivityInner)
