import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../shared/types'
import { planContextCompression, resolveContextUsage } from '../contextWindow'

function message(id: string, role: ChatMessage['role'], text: string): ChatMessage {
  return { id, role, text }
}

describe('context window planning', () => {
  it('estimates active context after a stored summary', () => {
    const messages = [
      message('m1', 'user', '旧消息'.repeat(100)),
      message('m2', 'assistant', '摘要覆盖到这里'),
      message('m3', 'user', '最近问题'),
      message('m4', 'assistant', '最近回答')
    ]
    const usage = resolveContextUsage({
      messages,
      contextTokens: 10000,
      maxOutputTokens: 1000,
      summaryThrough: 'm2',
      summaryTokens: 200,
      systemTokens: 300
    })

    expect(usage.usedTokens).toBeGreaterThan(500)
    expect(usage.usedTokens).toBeLessThan(700)
  })

  it('keeps recent messages and selects an older summary cutoff near the limit', () => {
    const messages = Array.from({ length: 80 }, (_, index) =>
      message(`m${index}`, index % 2 === 0 ? 'user' : 'assistant', `第 ${index} 条：${'上下文内容'.repeat(30)}`)
    )
    const plan = planContextCompression({
      messages,
      contextTokens: 5000,
      maxOutputTokens: 800,
      systemTokens: 300
    })

    expect(plan).not.toBeNull()
    expect(plan?.oldMessages.length).toBeGreaterThan(2)
    expect(plan?.recentMessages.length).toBeGreaterThan(2)
    expect(plan?.throughMessageId).toBe(plan?.oldMessages.at(-1)?.id)
    expect(plan?.estimatedAfterTokens).toBeLessThan(plan?.beforeTokens ?? 0)
  })

  it('does not compress a short conversation', () => {
    expect(planContextCompression({
      messages: [message('m1', 'user', '你好'), message('m2', 'assistant', '你好，请告诉我需要做什么。')],
      contextTokens: 128000,
      maxOutputTokens: 8192
    })).toBeNull()
  })
})
