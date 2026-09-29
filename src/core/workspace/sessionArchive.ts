import { normalizeApprovalPolicy, validateCreativePreferences } from '../../shared/creative'
import { parseAgentQuestion, parseSkillCandidate } from '../../shared/agentQuestions'
import type { ChatSession, OrchestrationRunRecord } from '../../shared/types'
import { validateMessageFiles } from '../attachments/validation'

export interface SessionArchive {
  fileName: string
  base64: string
}

export const MAX_SESSION_ARCHIVE_BYTES = 32 * 1024 * 1024
export const MAX_SESSION_MESSAGES = 10_000
export const MAX_SESSION_MESSAGE_TEXT_CHARS = 1_000_000
export const MAX_SESSION_SUMMARY_CHARS = 500_000
export const MAX_SESSION_MODEL_PREFERENCES = 50
export const MAX_ORCHESTRATION_RUNS = 10
export const MAX_ORCHESTRATION_STAGES = 50
export const MAX_ORCHESTRATION_ARTIFACTS = 100
export const MAX_SKILL_CANDIDATES = 20

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(MAX_SESSION_ARCHIVE_BYTES * 4 / 3) || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('会话文件大小或编码无效')
  const binary = atob(base64)
  if (binary.length > MAX_SESSION_ARCHIVE_BYTES) throw new Error('会话文件超过大小限制')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeOrchestrationRuns(value: unknown): OrchestrationRunRecord[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('编排运行记录格式无效')
  if (value.length > MAX_ORCHESTRATION_RUNS) throw new Error('编排运行记录数量超过限制')
  for (const run of value) {
    if (!run || typeof run !== 'object') throw new Error('编排运行记录格式无效')
    const candidate = run as Partial<OrchestrationRunRecord>
    if (typeof candidate.runId !== 'string' || candidate.runId.length > 200 || !['running', 'completed', 'failed', 'cancelled', 'paused_budget'].includes(candidate.status ?? '') || !Array.isArray(candidate.stages) || candidate.stages.length > MAX_ORCHESTRATION_STAGES || !Array.isArray(candidate.artifacts) || candidate.artifacts.length > MAX_ORCHESTRATION_ARTIFACTS || !candidate.overlay || typeof candidate.overlay !== 'object') {
      throw new Error('编排运行记录格式无效')
    }
    for (const stage of candidate.stages) {
      if (!stage || typeof stage !== 'object' || typeof (stage as { stageId?: unknown }).stageId !== 'string' || (stage as { stageId: string }).stageId.length > 200) throw new Error('编排阶段记录格式无效')
    }
    for (const artifact of candidate.artifacts) {
      if (!artifact || typeof artifact !== 'object') throw new Error('编排产物记录格式无效')
      const text = (artifact as { text?: unknown }).text
      if (text !== undefined && (typeof text !== 'string' || text.length > MAX_SESSION_MESSAGE_TEXT_CHARS)) throw new Error('编排产物正文超过限制')
    }
  }
  return value as OrchestrationRunRecord[]
}

function decodePlanningGate(value: unknown): ChatSession['planningGate'] {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('规划门格式无效')
  const candidate = value as { status?: unknown; reason?: unknown }
  if (candidate.status !== 'pending' && candidate.status !== 'approved' && candidate.status !== 'rejected') throw new Error('规划门状态无效')
  if (candidate.reason !== undefined && typeof candidate.reason !== 'string') throw new Error('规划门原因无效')
  return {
    status: candidate.status,
    ...(candidate.reason === undefined ? {} : { reason: candidate.reason })
  }
}

export function exportSessionArchive(session: ChatSession): SessionArchive {
  const payload = JSON.stringify(session, null, 2)
  const payloadBytes = new TextEncoder().encode(payload)
  if (payloadBytes.byteLength > MAX_SESSION_ARCHIVE_BYTES) throw new Error('会话文件超过大小限制')
  return {
    fileName: `${(session.title || '新会话').replace(/[\\/:*?"<>|]/g, '').trim() || 'session'}.storyfabric.session.json`,
    base64: bytesToBase64(payloadBytes)
  }
}

export function decodeSessionArchive(base64: string): ChatSession {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(base64)) } catch (error) {
    if (error instanceof Error && /大小|编码无效/.test(error.message)) throw error
    throw new Error('会话文件编码无效')
  }
  let value: Partial<ChatSession>
  try { value = JSON.parse(text) as Partial<ChatSession> } catch { throw new Error('会话文件 JSON 无效') }
  if (!value || typeof value !== 'object' || !Array.isArray(value.messages)) throw new Error('文件不是有效的 StoryFabric 会话')
  if (value.messages.length > MAX_SESSION_MESSAGES) throw new Error('会话消息数量超过限制')
  if (typeof value.title !== 'string' || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') {
    throw new Error('会话文件缺少必要字段')
  }
  let imageBytes = 0
  const messages = value.messages.map((message) => {
    if (!message || typeof message !== 'object') throw new Error('会话消息格式无效')
    const candidate = message as { role?: unknown; text?: unknown; toolCalls?: unknown }
    if (!['system', 'user', 'assistant', 'tool'].includes(String(candidate.role))) throw new Error('会话消息角色无效')
    if (candidate.text !== undefined && (typeof candidate.text !== 'string' || candidate.text.length > MAX_SESSION_MESSAGE_TEXT_CHARS)) throw new Error('会话消息正文超过限制')
    if (candidate.toolCalls !== undefined && (!Array.isArray(candidate.toolCalls) || candidate.toolCalls.length > 32 || candidate.toolCalls.some((call) => !call || typeof call !== 'object' || typeof (call as { argsJson?: unknown }).argsJson !== 'string' || (call as { argsJson: string }).argsJson.length > MAX_SESSION_MESSAGE_TEXT_CHARS))) throw new Error('工具调用记录超过限制')
    const files = (message as { files?: unknown }).files
    if (files !== undefined) {
      const normalized = validateMessageFiles(files, { sessionImageBytes: imageBytes })
      imageBytes += normalized.filter((file) => file.kind === 'image').reduce((sum, file) => sum + file.size, 0)
      return { ...message, files: normalized }
    }
    return message
  })
  const modelPreferences = value.modelPreferences
  if (modelPreferences !== undefined && (!Array.isArray(modelPreferences) || modelPreferences.length > MAX_SESSION_MODEL_PREFERENCES || modelPreferences.some((item) => !item || typeof item !== 'object' || typeof (item as any).providerId !== 'string' || typeof (item as any).model !== 'string' || !['inherit', 'off', 'low', 'medium', 'high'].includes((item as any).reasoning)))) {
    throw new Error('会话思考设置无效')
  }
  const creativePreferences = value.creativePreferences === undefined ? undefined : validateCreativePreferences(value.creativePreferences)
  if (value.archived !== undefined && typeof value.archived !== 'boolean') throw new Error('会话归档状态无效')
  const approvalPolicy = normalizeApprovalPolicy(value.approvalPolicy)
  const orchestrationRuns = decodeOrchestrationRuns(value.orchestrationRuns)
  const waitingQuestion = value.waitingQuestion === undefined ? undefined : parseAgentQuestion(value.waitingQuestion)
  const skillCandidates = value.skillCandidates === undefined
    ? undefined
    : Array.isArray(value.skillCandidates) ? value.skillCandidates.map(parseSkillCandidate) : (() => { throw new Error('技能候选记录格式无效') })()
  const planningGate = decodePlanningGate(value.planningGate)
  return {
    id: typeof value.id === 'string' ? value.id : '',
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    archived: Boolean(value.archived),
    messages,
    approvalPolicy,
    ...(modelPreferences === undefined ? {} : { modelPreferences }),
    ...(typeof value.contextSummary === 'string' && value.contextSummary.length <= MAX_SESSION_SUMMARY_CHARS ? { contextSummary: value.contextSummary } : value.contextSummary === undefined ? {} : (() => { throw new Error('会话摘要超过限制') })()),
    ...(typeof value.contextSummaryThrough === 'string' ? { contextSummaryThrough: value.contextSummaryThrough } : {}),
    ...(typeof value.contextSummaryUpdatedAt === 'number' ? { contextSummaryUpdatedAt: value.contextSummaryUpdatedAt } : {}),
    ...(creativePreferences ? { creativePreferences } : {}),
    ...(orchestrationRuns ? { orchestrationRuns } : {}),
    ...(waitingQuestion ? { waitingQuestion } : {}),
    ...(skillCandidates && skillCandidates.length <= MAX_SKILL_CANDIDATES ? { skillCandidates } : skillCandidates ? (() => { throw new Error('技能候选记录数量超过限制') })() : {}),
    ...(planningGate ? { planningGate } : {})
  } as ChatSession
}
