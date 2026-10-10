import { cloneValue } from '../../shared/runtimeCompatibility'
import type { RunEventEnvelope } from '../../shared/agentRuntime'
import { normalizeAgentMode, normalizeApprovalPolicy } from '../../shared/creative'
import type { AgentMode, ApprovalPolicy } from '../../shared/types'
import type { ApprovalAuditEntry } from './approvalAudit'
import type { AgentBudgetSnapshot } from '../../shared/types'
import type { AgentQuestion } from '../../shared/agentQuestions'

export type RuntimeRunStatus = 'created' | 'queued' | 'running' | 'awaiting_user' | 'paused_budget' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type DraftSaveStatus = 'saved' | 'unsaved'

export interface RuntimeDraft {
  messageId: string
  text: string
}

export interface RuntimeRunSnapshot {
  runId: string
  workspaceId: string
  sessionId: string
  agentId: string
  parentAgentId?: string
  clientRunId?: string
  requestHash?: string
  status: RuntimeRunStatus
  createdAt: number
  updatedAt: number
  lastSeq: number
  drafts: RuntimeDraft[]
  events: RunEventEnvelope[]
  draftSaveStatus: DraftSaveStatus
  terminalEventEmitted?: boolean
  questionId?: string
  waitingQuestion?: AgentQuestion
  /** 新字段对旧快照保持可选，读取时归一化为安全默认值。 */
  mode?: AgentMode
  approvalPolicy?: ApprovalPolicy
  goalId?: string
  approvalAudit?: ApprovalAuditEntry[]
  currentStage?: string
  completedStages?: string[]
  pauseReason?: 'budget' | 'cancelled' | 'error'
  error?: string
  budget?: AgentBudgetSnapshot
}

export interface RunStore {
  create(snapshot: RuntimeRunSnapshot): Promise<void>
  get(runId: string): Promise<RuntimeRunSnapshot | null>
  save(snapshot: RuntimeRunSnapshot): Promise<void>
  list(workspaceId: string, sessionId?: string): RuntimeRunSnapshot[]
}

function clone(snapshot: RuntimeRunSnapshot): RuntimeRunSnapshot {
  return cloneValue({
    ...snapshot,
    mode: normalizeAgentMode(snapshot.mode),
    approvalPolicy: normalizeApprovalPolicy(snapshot.approvalPolicy),
    approvalAudit: snapshot.approvalAudit ? [...snapshot.approvalAudit] : [],
    completedStages: [...(snapshot.completedStages ?? [])],
    ...(snapshot.waitingQuestion ? { waitingQuestion: cloneValue(snapshot.waitingQuestion) } : {})
  })
}

export class MemoryRunStore implements RunStore {
  private readonly snapshots = new Map<string, RuntimeRunSnapshot>()

  async create(snapshot: RuntimeRunSnapshot): Promise<void> {
    if (this.snapshots.has(snapshot.runId)) throw new Error('运行已存在')
    this.snapshots.set(snapshot.runId, clone(snapshot))
  }

  async get(runId: string): Promise<RuntimeRunSnapshot | null> {
    const snapshot = this.snapshots.get(runId)
    return snapshot ? clone(snapshot) : null
  }

  async save(snapshot: RuntimeRunSnapshot): Promise<void> {
    if (!this.snapshots.has(snapshot.runId)) throw new Error('运行不存在')
    this.snapshots.set(snapshot.runId, clone(snapshot))
  }

  list(workspaceId: string, sessionId?: string): RuntimeRunSnapshot[] {
    return [...this.snapshots.values()]
      .filter((snapshot) => (!workspaceId || snapshot.workspaceId === workspaceId) && (!sessionId || snapshot.sessionId === sessionId))
      .map(clone)
  }
}
