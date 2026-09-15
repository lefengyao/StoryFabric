import type { AgentEvent } from './types'

export const RUNTIME_EVENT_TYPES = [
  'run-start', 'stage-start', 'text-delta', 'tool-generating', 'tool-complete', 'artifact-delta',
  'stage-complete', 'child-start', 'child-complete', 'usage-update', 'pending-change', 'change-result',
  'run-paused', 'run-error', 'run-done'
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

export function validateRuntimeEvent(event: unknown): RuntimeEvent {
  if (!isRecord(event) || typeof event.type !== 'string' || !RUNTIME_EVENT_TYPE_SET.has(event.type)) throw new Error('不支持的运行事件类型')
  if (event.messageId !== undefined) requiredString(event.messageId, 'event.messageId')
  if (event.artifactId !== undefined) requiredString(event.artifactId, 'event.artifactId')
  if (event.delta !== undefined && typeof event.delta !== 'string') throw new Error('event.delta 必须是字符串')
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
  validateRuntimeEvent(value.event)
  return value as unknown as RunEventEnvelope
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
