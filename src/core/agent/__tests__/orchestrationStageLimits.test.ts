import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../shared/types'
import { estimateMessagesTokens } from '../contextWindow'
import { boundedStageMessages, orchestrationStageOutputLimit, orchestrationStageRoundLimit } from '../orchestrationStageLimits'

describe('orchestration stage limits', () => {
  it('keeps a large run-wide call budget from becoming a 100-round plan stage', () => {
    expect(orchestrationStageRoundLimit('plan', 300)).toBeLessThanOrEqual(24)
    expect(orchestrationStageRoundLimit('write', 300)).toBeLessThanOrEqual(32)
    expect(orchestrationStageRoundLimit('plan', 3)).toBe(3)
    expect(orchestrationStageOutputLimit('plan', 131072)).toBeLessThanOrEqual(16384)
  })

  it('bounds prior tool content while preserving the task and complete recent tool turns', () => {
    const messages: ChatMessage[] = [{ id: 'task', role: 'user', text: '规划章节' }]
    for (let index = 0; index < 12; index += 1) {
      messages.push({ id: `assistant-${index}`, role: 'assistant', toolCalls: [{ id: `call-${index}`, name: 'get_chapter', argsJson: JSON.stringify({ index }) }] })
      messages.push({ id: `result-${index}`, role: 'tool', toolCallId: `call-${index}`, toolName: 'get_chapter', text: '章节内容'.repeat(1200) })
    }

    const bounded = boundedStageMessages(messages, 10000)
    expect(bounded[0]).toBe(messages[0])
    expect(bounded.at(-1)).toBe(messages.at(-1))
    expect(bounded.length).toBeLessThan(messages.length)
    expect(estimateMessagesTokens(bounded)).toBeLessThanOrEqual(10000)
    for (const message of bounded.filter((item) => item.role === 'tool')) {
      expect(bounded.some((item) => item.role === 'assistant' && item.toolCalls?.some((call) => call.id === message.toolCallId))).toBe(true)
    }
  })
})
