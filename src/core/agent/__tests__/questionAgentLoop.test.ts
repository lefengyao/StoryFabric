import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatSession } from '../../../shared/types'
import type { LlmAdapter, LlmAdapterFactory, StreamResult } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

const providerId = 'question-provider'

function callAskUser(): StreamResult {
  return {
    text: '',
    stopReason: 'tool_calls',
    toolCalls: [{
      id: 'question-call',
      name: 'ask_user',
      argsJson: JSON.stringify({
        title: '选择视角',
        description: '请确认本章的叙事视角。',
        fields: [{ id: 'perspective', label: '视角', type: 'single', required: true, options: [{ id: 'first', label: '第一人称' }] }]
      })
    }]
  }
}

function text(value: string): StreamResult {
  return { text: value, toolCalls: [], stopReason: 'stop' }
}

async function createService(results: StreamResult[], events: AgentEvent[], store: MemoryFileStore): Promise<CoreAgentService> {
  const sessions = new CoreSessionStore(store)
  const queue = [...results]
  const adapter: LlmAdapter = {
    stream: async () => {
      const result = queue.shift()
      if (!result) throw new Error('脚本已耗尽')
      return result
    }
  }
  const factory: LlmAdapterFactory = () => adapter
  return new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://question.invalid/v1', apiKey: 'test-key' }] }),
    getAdapter: factory,
    emit: (_sessionId, event) => events.push(event)
  })
}

async function loadSession(store: MemoryFileStore, sessionId: string): Promise<ChatSession> {
  const session = await new CoreSessionStore(store).load(sessionId)
  if (!session) throw new Error('会话未落盘')
  return session
}

describe('CoreAgentService structured questions', () => {
  it('pauses the same run for an answer and resumes without duplicating terminal events', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, 'structured-question')
    const events: AgentEvent[] = []
    const service = await createService([callAskUser(), text('已按第一人称继续。')], events, store)
    const running = service.run({ message: '继续写作', providerId, model: 'question-model' })

    await vi.waitFor(() => expect(events.filter((event) => event.type === 'agent-question')).toHaveLength(1))
    const questionEvent = events.find((event): event is Extract<AgentEvent, { type: 'agent-question' }> => event.type === 'agent-question')
    if (!questionEvent) throw new Error('没有收到结构化问题')
    const beforeAnswer = await loadSession(store, questionEvent.question.sessionId)
    expect(beforeAnswer.waitingQuestion).toEqual(questionEvent.question)
    expect(events).toContainEqual({ type: 'waiting-user', questionId: questionEvent.question.questionId })
    expect(events.some((event) => event.type === 'done')).toBe(false)

    const answer = { questionId: questionEvent.question.questionId, answers: { perspective: 'first' } }
    await Promise.all([service.answerQuestion(answer), service.answerQuestion(answer)])
    const result = await running
    const afterAnswer = await loadSession(store, result.sessionId)

    expect(result.runId).toBe(questionEvent.question.runId)
    expect(afterAnswer.waitingQuestion).toBeUndefined()
    expect(afterAnswer.messages.some((message) => message.role === 'tool' && message.text?.includes('first'))).toBe(true)
    expect(events.filter((event) => event.type === 'agent-question')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'waiting-user')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1)
    expect(afterAnswer.messages.at(-1)?.text).toBe('已按第一人称继续。')
  })

  it('keeps a persisted question and rejects unsafe answer recovery after service restart', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, 'question-restart')
    const events: AgentEvent[] = []
    const service = await createService([callAskUser()], events, store)
    const running = service.run({ message: '继续写作', providerId, model: 'question-model' })
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'agent-question')).toHaveLength(1))
    const questionEvent = events.find((event): event is Extract<AgentEvent, { type: 'agent-question' }> => event.type === 'agent-question')
    if (!questionEvent) throw new Error('没有收到结构化问题')

    const restarted = await createService([], [], store)
    await expect(restarted.answerQuestion({ questionId: questionEvent.question.questionId, answers: { perspective: 'first' } }))
      .rejects.toThrow(/重启|安全|继续运行/)
    expect((await loadSession(store, questionEvent.question.sessionId)).waitingQuestion?.questionId)
      .toBe(questionEvent.question.questionId)

    service.abort(questionEvent.question.sessionId)
    await running
  })

})
