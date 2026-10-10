import { getSessionApprovalPolicy } from '../../../core/workspace/sessionPreferences'
import type { AgentBudgetSnapshot, ApprovalPolicy, ChatMessage, ChatSession, OrchestrationRunRecord, PendingChange, SessionModelPreference } from '../../../shared/types'
import type { CreativePreferences } from '../../../shared/creative'
import type { AgentQuestion, SkillCandidate } from '../../../shared/agentQuestions'

export interface SessionScopePatch {
  activeId: string
  messages: ChatMessage[]
  approvalPolicy: ApprovalPolicy
  creativePreferences?: CreativePreferences
  modelPreferences?: SessionModelPreference[]
  orchestrationRuns?: OrchestrationRunRecord[]
  budget: AgentBudgetSnapshot | null
  streamingText: string
  liveTimeline: []
  liveTools: []
  liveSkillEvents: []
  liveRuleEvents: []
  contextSummary?: string
  contextSummaryThrough?: string
  contextSummaryUpdatedAt?: number
  contextCompressing: false
  pendingQuestion: AgentQuestion | null
  pendingSkillCandidate: SkillCandidate | null
  waitingRunId: string | null
  pendingChange: PendingChange | null
  attachments: []
  messageFiles: []
  error: null
}

export interface WorkspaceScopePatch {
  activeId: null
  messages: []
  approvalPolicy: 'strict'
  creativePreferences: undefined
  modelPreferences: []
  orchestrationRuns: []
  budget: null
  streamingText: string
  streaming: false
  liveTimeline: []
  liveTools: []
  liveSkillEvents: []
  liveRuleEvents: []
  contextSummary: undefined
  contextSummaryThrough: undefined
  contextSummaryUpdatedAt: undefined
  contextCompressing: false
  contextCompression: null
  pendingQuestion: null
  pendingSkillCandidate: null
  waitingRunId: null
  pendingChange: null
  lastPendingChange: null
  lastAppliedChange: null
  attachments: []
  messageFiles: []
  error: null
}

export function sessionScopePatch(session: ChatSession): SessionScopePatch {
  return {
    activeId: session.id,
    messages: session.messages,
    approvalPolicy: getSessionApprovalPolicy(session),
    creativePreferences: session.creativePreferences,
    modelPreferences: session.modelPreferences ?? [],
    budget: session.orchestrationRuns?.at(-1)?.budget ?? null,
    orchestrationRuns: session.orchestrationRuns ?? [],
    streamingText: '',
    liveTimeline: [],
    liveTools: [],
    liveSkillEvents: [],
    liveRuleEvents: [],
    contextSummary: session.contextSummary,
    contextSummaryThrough: session.contextSummaryThrough,
    contextSummaryUpdatedAt: session.contextSummaryUpdatedAt,
    contextCompressing: false,
    pendingQuestion: null,
    pendingSkillCandidate: null,
    waitingRunId: null,
    pendingChange: session.pendingChange ?? null,
    attachments: [],
    messageFiles: [],
    error: null
  }
}

export function workspaceScopePatch(): WorkspaceScopePatch {
  return {
    activeId: null,
    messages: [],
    approvalPolicy: 'strict',
    creativePreferences: undefined,
    modelPreferences: [],
    orchestrationRuns: [],
    budget: null,
    streamingText: '',
    streaming: false,
    liveTimeline: [],
    liveTools: [],
    liveSkillEvents: [],
    liveRuleEvents: [],
    contextSummary: undefined,
    contextSummaryThrough: undefined,
    contextSummaryUpdatedAt: undefined,
    contextCompressing: false,
    contextCompression: null,
    pendingQuestion: null,
    pendingSkillCandidate: null,
    waitingRunId: null,
    pendingChange: null,
    lastPendingChange: null,
    lastAppliedChange: null,
    attachments: [],
    messageFiles: [],
    error: null
  }
}

export function shouldKeepStreamingAfterAcceptance({ accepted, done }: { accepted: boolean; done: boolean }): boolean {
  return accepted && !done
}

/**
 * 审批策略按会话保存；运行开始时会把策略冻结到本次请求，因此运行期间
 * 修改只影响下一次运行，不应因为当前流仍在持续就把控件锁死。
 */
export function approvalPolicyPickerDisabled({ activeId }: { activeId: string | null; streaming: boolean }): boolean {
  return !activeId
}
