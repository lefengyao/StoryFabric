import type { ChatSession, OrchestrationRunRecord } from '../../shared/types'
import { validateMessageFiles } from '../attachments/validation'
import { validateCreativePreferences } from '../../shared/creative'

export interface SessionArchive {
  fileName: string
  base64: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeOrchestrationRuns(value: unknown): OrchestrationRunRecord[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('编排运行记录格式无效')
  for (const run of value) {
    if (!run || typeof run !== 'object') throw new Error('编排运行记录格式无效')
    const candidate = run as Partial<OrchestrationRunRecord>
    if (typeof candidate.runId !== 'string' || !['running', 'completed', 'failed', 'cancelled'].includes(candidate.status ?? '') || !Array.isArray(candidate.stages) || !Array.isArray(candidate.artifacts) || !candidate.overlay || typeof candidate.overlay !== 'object') {
      throw new Error('编排运行记录格式无效')
    }
  }
  return value as OrchestrationRunRecord[]
}

export function exportSessionArchive(session: ChatSession): SessionArchive {
  const payload = JSON.stringify(session, null, 2)
  return {
    fileName: `${(session.title || '新会话').replace(/[\\/:*?"<>|]/g, '').trim() || 'session'}.storyfabric.session.json`,
    base64: bytesToBase64(new TextEncoder().encode(payload))
  }
}

export function decodeSessionArchive(base64: string): ChatSession {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(base64)) } catch { throw new Error('会话文件编码无效') }
  const value = JSON.parse(text) as Partial<ChatSession>
  if (!value || typeof value !== 'object' || !Array.isArray(value.messages)) throw new Error('文件不是有效的 StoryFabric 会话')
  if (typeof value.title !== 'string' || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') {
    throw new Error('会话文件缺少必要字段')
  }
  let imageBytes = 0
  const messages = value.messages.map((message) => {
    if (!message || typeof message !== 'object') throw new Error('会话消息格式无效')
    const files = (message as { files?: unknown }).files
    if (files !== undefined) {
      const normalized = validateMessageFiles(files, { sessionImageBytes: imageBytes })
      imageBytes += normalized.filter((file) => file.kind === 'image').reduce((sum, file) => sum + file.size, 0)
      return { ...message, files: normalized }
    }
    return message
  })
  const modelPreferences = value.modelPreferences
  if (modelPreferences !== undefined && (!Array.isArray(modelPreferences) || modelPreferences.some((item) => !item || typeof item !== 'object' || typeof (item as any).providerId !== 'string' || typeof (item as any).model !== 'string' || !['inherit', 'off', 'low', 'medium', 'high'].includes((item as any).reasoning)))) {
    throw new Error('会话思考设置无效')
  }
  const creativePreferences = value.creativePreferences === undefined ? undefined : validateCreativePreferences(value.creativePreferences)
  const orchestrationRuns = decodeOrchestrationRuns(value.orchestrationRuns)
  return {
    id: typeof value.id === 'string' ? value.id : '',
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    archived: Boolean(value.archived),
    messages,
    ...(modelPreferences === undefined ? {} : { modelPreferences }),
    ...(typeof value.contextSummary === 'string' ? { contextSummary: value.contextSummary } : {}),
    ...(typeof value.contextSummaryThrough === 'string' ? { contextSummaryThrough: value.contextSummaryThrough } : {}),
    ...(typeof value.contextSummaryUpdatedAt === 'number' ? { contextSummaryUpdatedAt: value.contextSummaryUpdatedAt } : {}),
    ...(creativePreferences ? { creativePreferences } : {}),
    ...(orchestrationRuns ? { orchestrationRuns } : {})
  } as ChatSession
}
