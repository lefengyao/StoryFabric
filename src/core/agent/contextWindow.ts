import type { ChatMessage } from '../../shared/types'

export interface ContextUsage {
  usedTokens: number
  contextTokens: number
  inputBudgetTokens: number
  remainingTokens: number
  ratio: number
}

export interface CompressionPlan {
  oldMessages: ChatMessage[]
  recentMessages: ChatMessage[]
  throughMessageId: string
  beforeTokens: number
  estimatedAfterTokens: number
}

/** 粗略估算文本 token：中文按约 0.8 token/字，其他字符按约 0.25 token/字。 */
export function estimateTextTokens(text: string | undefined): number {
  if (!text) return 0
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const other = Math.max(0, Array.from(text).length - cjk)
  return Math.max(1, Math.ceil(cjk * 0.8 + other * 0.25))
}

export function estimateMessageTokens(message: ChatMessage): number {
  let tokens = 4 + estimateTextTokens(message.text)
  for (const call of message.toolCalls ?? []) {
    tokens += 8 + estimateTextTokens(call.name) + estimateTextTokens(call.argsJson)
  }
  for (const file of message.files ?? []) {
    tokens += file.kind === 'image' ? 1000 : estimateTextTokens(file.text) + 8
  }
  return tokens
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

export function messagesAfterSummary(messages: ChatMessage[], throughMessageId?: string): ChatMessage[] {
  if (!throughMessageId) return messages
  const index = messages.findIndex((message) => message.id === throughMessageId)
  return index < 0 ? messages : messages.slice(index + 1)
}

export function resolveContextUsage(options: {
  messages: ChatMessage[]
  contextTokens: number
  maxOutputTokens: number
  summaryThrough?: string
  summaryTokens?: number
  systemTokens?: number
}): ContextUsage {
  const active = messagesAfterSummary(options.messages, options.summaryThrough)
  const usedTokens = Math.max(0, (options.summaryTokens ?? 0) + (options.systemTokens ?? 0) + estimateMessagesTokens(active))
  const inputBudgetTokens = Math.max(1024, options.contextTokens - options.maxOutputTokens)
  return {
    usedTokens,
    contextTokens: options.contextTokens,
    inputBudgetTokens,
    remainingTokens: Math.max(0, options.contextTokens - usedTokens),
    ratio: usedTokens / Math.max(1, options.contextTokens)
  }
}

/**
 * 达到输入预算的约 78% 时，保留最近约 35% 的对话原文，把更早内容交给摘要器。
 * 返回 null 表示当前无需压缩。
 */
export function planContextCompression(options: {
  messages: ChatMessage[]
  contextTokens: number
  maxOutputTokens: number
  summaryThrough?: string
  summaryTokens?: number
  systemTokens?: number
}): CompressionPlan | null {
  const active = messagesAfterSummary(options.messages, options.summaryThrough)
  const beforeTokens = resolveContextUsage(options).usedTokens
  const inputBudgetTokens = Math.max(1024, options.contextTokens - options.maxOutputTokens)
  if (beforeTokens < inputBudgetTokens * 0.78) return null

  const keepBudget = Math.max(3000, Math.min(inputBudgetTokens * 0.35, options.contextTokens * 0.3))
  let keepStart = active.length
  let keptTokens = 0
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const cost = estimateMessageTokens(active[index])
    if (keptTokens + cost > keepBudget && active.length - index >= 2) break
    keepStart = index
    keptTokens += cost
  }

  const lastUserIndex = active.findLastIndex((message) => message.role === 'user')
  if (lastUserIndex >= 0) keepStart = Math.min(keepStart, lastUserIndex)
  if (keepStart < 2) return null

  const oldMessages = active.slice(0, keepStart)
  const recentMessages = active.slice(keepStart)
  const throughMessageId = oldMessages.at(-1)?.id
  if (!throughMessageId) return null

  return {
    oldMessages,
    recentMessages,
    throughMessageId,
    beforeTokens,
    estimatedAfterTokens: (options.summaryTokens ?? 0) + (options.systemTokens ?? 0) + estimateMessagesTokens(recentMessages)
  }
}

export function summaryTranscriptChunks(messages: ChatMessage[], maxChars = 24000): string[] {
  const chunks: string[] = []
  let current = ''
  for (const message of messages) {
    const files = message.files?.map((file) => `${file.name}(${file.kind})`).join(', ')
    const calls = message.toolCalls?.map((call) => `${call.name} ${call.argsJson.slice(0, 500)}`).join('; ')
    const text = [
      message.role.toUpperCase(),
      message.toolName ? `[${message.toolName}]` : '',
      message.text?.slice(0, 6000) ?? '',
      calls ? `工具调用：${calls}` : '',
      files ? `附件：${files}` : ''
    ].filter(Boolean).join('\n')
    if (current && current.length + text.length + 2 > maxChars) {
      chunks.push(current)
      current = ''
    }
    current += `${current ? '\n\n' : ''}${text}`
  }
  if (current) chunks.push(current)
  return chunks
}

export function fallbackContextSummary(previousSummary: string, messages: ChatMessage[]): string {
  const lines = messages.slice(-40).map((message) => {
    const label = message.role === 'user' ? '用户' : message.role === 'tool' ? `工具 ${message.toolName ?? ''}` : '智能体'
    const text = (message.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
    return text ? `- ${label}：${text}` : ''
  }).filter(Boolean)
  return [previousSummary.trim(), '【较早对话压缩记录】', ...lines].filter(Boolean).join('\n')
}
