import { describe, expect, it } from 'vitest'
import type { AgentQuestion } from '../../../shared/agentQuestions'
import type { ChatMessage } from '../../../shared/types'
import { runToolLoop } from '../toolLoop'

describe('runToolLoop structured user waiting', () => {
  it('returns waiting-user for ask_user and keeps tool callbacks consistent', async () => {
    const question: AgentQuestion = {
      questionId: 'question-1',
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'write',
      title: '确认',
      description: '请确认',
      fields: [{ id: 'answer', label: '答案', type: 'text', required: true }]
    }
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '继续' }]
    const starts: string[] = []
    const dones: string[] = []

    const result = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 1,
      callModel: async () => ({
        text: '',
        toolCalls: [{ id: 'call-1', name: 'ask_user', argsJson: '{}' }],
        stopReason: 'tool_calls'
      }),
      executeTool: async () => ({ ok: true, text: '', preview: '等待用户回答', waitingUser: question } as never),
      onToolStart: (toolCall) => starts.push(toolCall.name),
      onToolDone: (toolCall) => dones.push(toolCall.name)
    })

    expect((result as unknown as { waitingUser?: unknown }).waitingUser).toEqual(expect.objectContaining({ question, toolCall: expect.objectContaining({ name: 'ask_user' }) }))
    expect(result.stoppedReason).toBe('waiting-user')
    expect(starts).toEqual(['ask_user'])
    expect(dones).toEqual(['ask_user'])
    expect(messages.filter((message) => message.role === 'tool')).toHaveLength(0)
  })

  it('returns tool results for every call when a control tool is mixed with another call', async () => {
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '继续' }]
    let modelCalls = 0
    const result = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 2,
      callModel: async () => {
        modelCalls += 1
        return modelCalls === 1
          ? { text: '', toolCalls: [{ id: 'question', name: 'ask_user', argsJson: '{}' }, { id: 'read', name: 'list_notes', argsJson: '{}' }], stopReason: 'tool_calls' as const }
          : { text: '已修正调用方式。', toolCalls: [], stopReason: 'stop' as const }
      },
      executeTool: async () => ({ ok: true, text: '不应执行', preview: '不应执行' })
    })

    expect(result.stoppedReason).toBe('completed')
    expect(messages.filter((message) => message.role === 'tool')).toHaveLength(2)
    expect(messages.filter((message) => message.role === 'tool').every((message) => message.isError)).toBe(true)
  })
})
