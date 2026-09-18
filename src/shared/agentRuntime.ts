import type { AgentEvent } from './types'
import { parseAgentQuestion, parseSkillCandidate } from './agentQuestions'

export const RUNTIME_EVENT_TYPES = [
  'run-start', 'stage-start', 'text-delta', 'tool-generating', 'tool-complete', 'artifact-delta',
  'stage-complete', 'child-start', 'child-complete', 'usage-update', 'pending-change', 'change-result',
  'goal-plan', 'goal-task', 'goal-validation', 'approval-policy', 'request-context', 'tool-receipt', 'skill-activity',
  'run-paused', 'run-error', 'run-done', 'agent-question', 'skill-candidate', 'waiting-user'
] as const

export type RuntimeEventType = typeof RUNTIME_EVENT_TYPES[number]

export interface RuntimeEvent {
  type: RuntimeEventType
  messageId?: string
  artifactId?: string
  delta?: string
  payload?: unknown
}

export interface RunEventEnvelope {
  schemaVersion: 1
  workspaceId: string
  sessionId: string
  runId: string
  agentId: string
  parentAgentId?: string
  stageId?: string
  seq: number
  at: number
  event: RuntimeEvent
}

export interface LegacyEventContext {
  workspaceId: string
  sessionId: string
  runId: string
  agentId: string
  parentAgentId?: string
  stageId?: string
  seq: number
  at?: number
  event: AgentEvent
}

const RUNTIME_EVENT_TYPE_SET = new Set<string>(RUNTIME_EVENT_TYPES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} 必须是非空字符串`)
  return value
}

function payloadRecord(event: Record<string, unknown>, name: string): Record<string, unknown> {
  if (!isRecord(event.payload)) throw new Error(`${name} 的 payload 必须是对象`)
  return event.payload
}

function validateStructuredEventPayload(event: Record<string, unknown>, identity?: { runId: string; sessionId: string; agentId: string; stageId?: string }): void {
  if (event.type === 'agent-question') {
    const payload = payloadRecord(event, event.type)
    const questionId = requiredString(payload.questionId, 'event.payload.questionId')
    const question = parseAgentQuestion(payload.question)
    if (question.questionId !== questionId) throw new Error('event.payload.questionId 与 question.questionId 不匹配')
    if (identity && (question.runId !== identity.runId || question.sessionId !== identity.sessionId || question.agentId !== identity.agentId || (question.stageId !== undefined && identity.stageId !== undefined && question.stageId !== identity.stageId))) {
      throw new Error('agent-question 的身份字段与运行事件 envelope 不匹配')
    }
    return
  }
  if (event.type === 'skill-candidate') {
    const payload = payloadRecord(event, event.type)
    const candidateId = requiredString(payload.candidateId, 'event.payload.candidateId')
    const candidate = parseSkillCandidate(payload.candidate)
    if (candidate.candidateId !== candidateId) throw new Error('event.payload.candidateId 与 candidate.candidateId 不匹配')
    if (identity && (candidate.runId !== identity.runId || candidate.sessionId !== identity.sessionId || candidate.agentId !== identity.agentId)) {
      throw new Error('skill-candidate 的身份字段与运行事件 envelope 不匹配')
    }
    return
  }
  if (event.type === 'waiting-user') {
    const payload = payloadRecord(event, event.type)
    const hasQuestionId = payload.questionId !== undefined
    const hasCandidateId = payload.candidateId !== undefined
    if (hasQuestionId === hasCandidateId) throw new Error('waiting-user 的 payload 必须且只能包含 questionId 或 candidateId')
    if (hasQuestionId) requiredString(payload.questionId, 'event.payload.questionId')
    if (hasCandidateId) requiredString(payload.candidateId, 'event.payload.candidateId')
  }
}

function validateEventShape(event: Record<string, unknown>): void {
  switch (event.type) {
    case 'text-delta':
      requiredString(event.messageId, 'event.messageId')
      if (typeof event.delta !== 'string') throw new Error('text-delta 的 delta 必须是字符串')
      return
    case 'run-start':
    case 'stage-start':
    case 'stage-complete':
    case 'tool-generating':
    case 'tool-complete':
    case 'artifact-delta':
    case 'usage-update':
    case 'pending-change':
    case 'change-result':
    case 'goal-plan':
    case 'goal-task':
    case 'goal-validation':
    case 'approval-policy':
    case 'request-context':
    case 'tool-receipt':
    case 'skill-activity':
    case 'run-paused':
    case 'run-error':
      payloadRecord(event, event.type)
      return
    case 'run-done':
      if (event.payload !== undefined && !isRecord(event.payload)) throw new Error('run-done 的 payload 必须是对象')
      return
    case 'child-start':
    case 'child-complete':
      payloadRecord(event, event.type)
      return
    case 'agent-question':
    case 'skill-candidate':
    case 'waiting-user':
      return
    default:
      return assertNeverRuntime(String(event.type))
  }
}

export function validateRuntimeEvent(event: unknown): RuntimeEvent {
  if (!isRecord(event) || typeof event.type !== 'string' || !RUNTIME_EVENT_TYPE_SET.has(event.type)) throw new Error('不支持的运行事件类型')
  if (event.messageId !== undefined) requiredString(event.messageId, 'event.messageId')
  if (event.artifactId !== undefined) requiredString(event.artifactId, 'event.artifactId')
  if (event.delta !== undefined && typeof event.delta !== 'string') throw new Error('event.delta 必须是字符串')
  validateEventShape(event)
  validateStructuredEventPayload(event)
  return event as unknown as RuntimeEvent
}

export function validateRunEventEnvelope(value: unknown): RunEventEnvelope {
  if (!isRecord(value)) throw new Error('运行事件必须是对象')
  if (value.schemaVersion !== 1) throw new Error('不支持的运行事件 schemaVersion')
  for (const key of ['workspaceId', 'sessionId', 'runId', 'agentId']) requiredString(value[key], key)
  if (value.parentAgentId !== undefined) requiredString(value.parentAgentId, 'parentAgentId')
  if (value.stageId !== undefined) requiredString(value.stageId, 'stageId')
  if (typeof value.seq !== 'number' || !Number.isInteger(value.seq) || value.seq < 1) throw new Error('seq 必须是正整数')
  if (typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at < 0) throw new Error('at 必须是时间戳')
  validateRuntimeEventWithIdentity(value.event, {
    runId: value.runId as string,
    sessionId: value.sessionId as string,
    agentId: value.agentId as string,
    ...(value.stageId === undefined ? {} : { stageId: value.stageId as string })
  })
  return value as unknown as RunEventEnvelope
}

function validateRuntimeEventWithIdentity(event: unknown, identity: { runId: string; sessionId: string; agentId: string; stageId?: string }): RuntimeEvent {
  if (!isRecord(event) || typeof event.type !== 'string' || !RUNTIME_EVENT_TYPE_SET.has(event.type)) throw new Error('不支持的运行事件类型')
  if (event.messageId !== undefined) requiredString(event.messageId, 'event.messageId')
  if (event.artifactId !== undefined) requiredString(event.artifactId, 'event.artifactId')
  if (event.delta !== undefined && typeof event.delta !== 'string') throw new Error('event.delta 必须是字符串')
  validateEventShape(event)
  validateStructuredEventPayload(event, identity)
  return event as unknown as RuntimeEvent
}

export function adaptLegacyAgentEvent(context: LegacyEventContext): RunEventEnvelope {
  const event = context.event
  let runtime: RuntimeEvent
  switch (event.type) {
    case 'session':
      runtime = { type: 'run-start', payload: { session: event.session } }
      break
    case 'text-delta':
      runtime = { type: 'text-delta', messageId: event.messageId, delta: event.delta }
      break
    case 'stage-start':
      runtime = { type: 'stage-start', payload: { stageId: event.stageId } }
      break
    case 'stage-complete':
      runtime = { type: 'stage-complete', payload: { stageId: event.stageId, artifactId: event.artifactId } }
      break
    case 'tool-start':
      runtime = { type: 'tool-generating', payload: { callId: event.callId, name: event.name, argsJson: event.argsJson } }
      break
    case 'tool-args-delta':
      runtime = { type: 'tool-generating', payload: { callId: event.callId, argsDelta: event.delta } }
      break
    case 'tool-preview':
      runtime = { type: 'artifact-delta', payload: { callId: event.callId, preview: event.preview } }
      break
    case 'budget':
      runtime = { type: 'usage-update', payload: event.goalId ? { snapshot: event.snapshot, goalId: event.goalId } : event.snapshot }
      break
    case 'tool-done':
      runtime = { type: 'tool-complete', payload: { callId: event.callId, ok: event.ok, resultPreview: event.resultPreview } }
      break
    case 'pending-change':
      runtime = { type: 'pending-change', payload: { change: event.change } }
      break
    case 'change-applied':
      runtime = { type: 'change-result', payload: { changeId: event.changeId, approved: event.approved } }
      break
    case 'change-result':
      runtime = { type: 'change-result', payload: event }
      break
    case 'goal-plan':
      runtime = { type: 'goal-plan', payload: event.goal }
      break
    case 'goal-task':
      runtime = { type: 'goal-task', payload: { goalId: event.goalId, task: event.task } }
      break
    case 'goal-validation':
      runtime = { type: 'goal-validation', payload: { goalId: event.goalId, taskId: event.taskId, passed: event.passed, reason: event.reason } }
      break
    case 'approval-policy':
      runtime = { type: 'approval-policy', payload: event }
      break
    case 'request-context':
      runtime = { type: 'request-context', payload: { usage: event.usage } }
      break
    case 'tool-receipt':
      runtime = { type: 'tool-receipt', payload: { receipt: event.receipt } }
      break
    case 'skill-activity':
      runtime = { type: 'skill-activity', payload: { activity: event.activity } }
      break
    case 'run-paused':
      runtime = { type: 'run-paused', payload: event }
      break
    case 'agent-question':
      {
        const question = parseAgentQuestion(event.question)
        runtime = { type: 'agent-question', payload: { questionId: question.questionId, question } }
      }
      break
    case 'skill-candidate':
      {
        const candidate = parseSkillCandidate(event.candidate)
        runtime = { type: 'skill-candidate', payload: { candidateId: candidate.candidateId, candidate } }
      }
      break
    case 'waiting-user':
      runtime = { type: 'waiting-user', payload: event }
      break
    case 'context-compression-start':
      runtime = { type: 'stage-start', payload: event }
      break
    case 'context-compressed':
      runtime = { type: 'stage-complete', payload: event }
      break
    case 'error':
      runtime = { type: 'run-error', payload: { message: event.message } }
      break
    case 'done':
      runtime = { type: 'run-done', payload: event.session ? { session: event.session } : undefined }
      break
    default:
      return assertNever(event)
  }
  return validateRunEventEnvelope({
    schemaVersion: 1,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    runId: context.runId,
    agentId: context.agentId,
    ...(context.parentAgentId ? { parentAgentId: context.parentAgentId } : {}),
    ...(context.stageId ? { stageId: context.stageId } : {}),
    seq: context.seq,
    at: context.at ?? Date.now(),
    event: runtime
  })
}

function assertNever(value: never): never {
  throw new Error(`无法适配旧事件：${String(value)}`)
}

function assertNeverRuntime(value: string): never {
  throw new Error(`无法校验运行事件：${String(value)}`)
}

export interface ClientRunClaim {
  workspaceId: string
  clientRunId: string
  requestHash: string
  runId: string
}

export type ClientRunClaimResult = { created: true; runId: string } | { created: false; runId: string }

export class ClientRunIdRegistry {
  private readonly claims = new Map<string, { requestHash: string; runId: string }>()

  claim(input: ClientRunClaim): ClientRunClaimResult {
    requiredString(input.workspaceId, 'workspaceId')
    requiredString(input.clientRunId, 'clientRunId')
    requiredString(input.requestHash, 'requestHash')
    requiredString(input.runId, 'runId')
    const key = `${input.workspaceId}\u0000${input.clientRunId}`
    const existing = this.claims.get(key)
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new Error('相同幂等键的请求内容已 changed')
      return { created: false, runId: existing.runId }
    }
    this.claims.set(key, { requestHash: input.requestHash, runId: input.runId })
    return { created: true, runId: input.runId }
  }

  forget(workspaceId: string, clientRunId: string): void {
    this.claims.delete(`${workspaceId}\u0000${clientRunId}`)
  }
}
