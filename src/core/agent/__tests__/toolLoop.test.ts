import { describe, expect, it } from 'vitest'
import type { AgentQuestion } from '../../../shared/agentQuestions'
import type { ChatMessage } from '../../../shared/types'
import { runToolLoop } from '../toolLoop'

describe('runToolLoop structured user waiting', () => {
  it('stops alternating repeated tool batches before executing a third cycle', async () => {
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '读取章节' }]
    let modelCalls = 0
    let toolExecutions = 0
    const result = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 40,
      callModel: async () => {
        modelCalls += 1
        const offset = modelCalls % 2 ? 0 : 1250
        return {
          text: '',
          toolCalls: [{ id: `read-${modelCalls}`, name: 'get_chapter', argsJson: JSON.stringify({ chapterId: 'chapter-1', offset }) }],
          stopReason: 'tool_calls' as const
        }
      },
      executeTool: async () => {
        toolExecutions += 1
        return { ok: true, text: '章节内容', preview: '章节内容' }
      }
    })

    expect(result.stoppedReason).toBe('repeated-tool-calls')
    expect(modelCalls).toBe(6)
    expect(toolExecutions).toBe(5)
  })

  it('lets an orchestration stage finish after one blocked repeat and a recovery instruction', async () => {
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '汇总已有资料' }]
    let modelCalls = 0
    let toolExecutions = 0
    const result = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 12,
      recoverRepeatedToolCalls: true,
      callModel: async () => {
        modelCalls += 1
        return modelCalls <= 6
          ? { text: '', toolCalls: [{ id: `read-${modelCalls}`, name: 'get_chapter', argsJson: JSON.stringify({ offset: modelCalls % 2 }) }], stopReason: 'tool_calls' as const }
          : { text: '根据已读取章节完成计划。', toolCalls: [], stopReason: 'stop' as const }
      },
      executeTool: async () => {
        toolExecutions += 1
        return { ok: true, text: '章节内容', preview: '章节内容' }
      }
    })

    expect(result.stoppedReason).toBe('completed')
    expect(modelCalls).toBe(7)
    expect(toolExecutions).toBe(5)
    expect(messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'read-6', isError: true }))
    expect(messages.some((item) => item.role === 'user' && item.text?.includes('已有工具结果'))).toBe(true)
  })

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

  it('converts a tool executor exception into a tool error so the next request remains valid', async () => {
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '保存' }]
    let modelCalls = 0
    const result = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 2,
      callModel: async ({ messages: current }) => {
        modelCalls += 1
        if (modelCalls === 1) return { text: '', toolCalls: [{ id: 'save-1', name: 'save_chapter', argsJson: '{}' }], stopReason: 'tool_calls' as const }
        expect(current).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', toolCallId: 'save-1', isError: true })]))
        return { text: '已报告保存失败。', toolCalls: [], stopReason: 'stop' as const }
      },
      executeTool: async () => { throw new Error('保存时发生 I/O 错误') }
    })

    expect(result.stoppedReason).toBe('completed')
    expect(messages.find((message) => message.toolCallId === 'save-1')?.text).toContain('保存时发生 I/O 错误')
    expect(messages.at(-1)?.text).toBe('已报告保存失败。')
  })

  it('does not persist an empty assistant turn when the provider returns no text or tools', async () => {
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '检查资料' }]
    let modelCalls = 0
    const result = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 2,
      callModel: async () => { modelCalls += 1; return { text: '', toolCalls: [], stopReason: 'stop' as const } },
      executeTool: async () => ({ ok: true, text: '', preview: '' })
    })

    expect(result.stoppedReason).toBe('empty-response')
    expect(modelCalls).toBe(2)
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
    expect(messages.some((message) => message.role === 'user' && message.text?.includes('空响应'))).toBe(true)
  })

  it('recovers from one empty response when the retry returns visible text', async () => {
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '检查资料' }]
    let modelCalls = 0
    const result = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 2,
      callModel: async () => {
        modelCalls += 1
        return modelCalls === 1
          ? { text: '', toolCalls: [], stopReason: 'stop' as const }
          : { text: '核查完成。', toolCalls: [], stopReason: 'stop' as const }
      },
      executeTool: async () => ({ ok: true, text: '', preview: '' })
    })

    expect(result.stoppedReason).toBe('completed')
    expect(result.text).toBe('核查完成。')
    expect(modelCalls).toBe(2)
  })
})
