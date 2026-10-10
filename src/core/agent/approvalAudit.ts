import type { ApprovalPolicy } from '../../shared/types'
import type { MutationKind } from './approvalPolicy'

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'invalidated'
export type ApprovalResult = 'pending' | 'applied' | 'rejected' | 'conflict' | 'failed' | 'invalidated'

export interface ApprovalAuditEntry {
  id: string
  runId: string
  goalId?: string
  taskId?: string
  toolName: string
  mutationKind?: MutationKind
  argsDigest: string
  policy: ApprovalPolicy
  requestedAt: number
  decision: ApprovalDecision
  result: ApprovalResult
  resultSummary?: string
  resolvedAt?: number
}

export interface ApprovalRequestInput {
  runId: string
  goalId?: string
  taskId?: string
  toolName: string
  mutationKind?: MutationKind
  argsJson: string
  policy: ApprovalPolicy
}

export interface ApprovalResolution {
  decision: Exclude<ApprovalDecision, 'pending'>
  result: Exclude<ApprovalResult, 'pending'>
  resultSummary?: string
}

async function digestArgs(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('')
  }
  let hash = 2166136261
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619)
  return `fallback-${(hash >>> 0).toString(16)}`
}

export class ApprovalAuditLog {
  private readonly entries: ApprovalAuditEntry[] = []
  private nextId = 1

  async request(input: ApprovalRequestInput): Promise<string> {
    const id = `${input.runId}:${input.goalId ?? 'run'}:${input.taskId ?? 'task'}:${this.nextId++}`
    this.entries.push({
      id,
      runId: input.runId,
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      toolName: input.toolName,
      ...(input.mutationKind ? { mutationKind: input.mutationKind } : {}),
      argsDigest: await digestArgs(input.argsJson),
      policy: input.policy,
      requestedAt: Date.now(),
      decision: 'pending',
      result: 'pending'
    })
    return id
  }

  async resolve(id: string, resolution: ApprovalResolution): Promise<void> {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry || entry.result !== 'pending') return
    entry.decision = resolution.decision
    entry.result = resolution.result
    entry.resultSummary = resolution.resultSummary
    entry.resolvedAt = Date.now()
  }

  async invalidatePending(runId: string): Promise<void> {
    for (const entry of this.entries) {
      if (entry.runId !== runId || entry.result !== 'pending') continue
      await this.resolve(entry.id, { decision: 'invalidated', result: 'invalidated', resultSummary: '运行已停止，审批项失效' })
    }
  }

  list(runId?: string): ApprovalAuditEntry[] {
    return this.entries.filter((entry) => !runId || entry.runId === runId).map((entry) => ({ ...entry }))
  }
}
