import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, StoryFabricApi } from '../../../../shared/api'
import { installPlatformApi } from '../../platform/platformApi'
import { useChat } from '../chatStore'

afterEach(() => {
  useChat.getState().resetWorkspace()
  vi.restoreAllMocks()
})

describe('chat stream interleaving', () => {
  it('keeps interleaved child deltas in two complete messages with unique rows', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => {
      throw new Error('event listener was not bound')
    }
    installPlatformApi({
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => {
        emit = callback
        return () => undefined
      })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_interleaving', streaming: true, liveTimeline: [], streamingText: '', liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    for (const [messageId, delta] of [['child_a', '甲'], ['child_b', '一'], ['child_a', '乙'], ['child_b', '二']] as const) {
      emit({ sessionId: 'session_interleaving', runId: 'run_interleaving', event: { type: 'text-delta', messageId, delta } })
    }
    emit({ sessionId: 'session_interleaving', runId: 'run_interleaving', event: { type: 'error', message: 'flush' } })

    await vi.waitFor(() => expect(useChat.getState().liveTimeline.filter((item) => item.kind === 'text')).toHaveLength(2))
    const textRows = useChat.getState().liveTimeline.filter((item): item is Extract<typeof item, { kind: 'text' }> => item.kind === 'text')
    expect(textRows.map((row) => row.text)).toEqual(['甲乙', '一二'])
    expect(new Set(textRows.map((row) => row.id)).size).toBe(textRows.length)
    unsubscribe()
  })

  it('shows a structured question without merging its payload into streaming text and ignores another session', () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    installPlatformApi({
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => {
        emit = callback
        return () => undefined
      })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session-question', streaming: true, liveTimeline: [], streamingText: '', liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()
    const question = {
      questionId: 'question-1', runId: 'run-question', sessionId: 'session-question', agentId: 'planner',
      title: '请选择方向', description: '请选择一个方向', fields: [{ id: 'direction', label: '方向', type: 'single' as const, required: true, options: [{ id: 'a', label: 'A' }] }]
    }
    emit({ sessionId: 'other-session', runId: 'run-question', event: { type: 'agent-question', question: { ...question, sessionId: 'other-session' } } })
    expect(useChat.getState().pendingQuestion).toBeNull()
    emit({ sessionId: 'session-question', runId: 'run-question', event: { type: 'text-delta', messageId: 'm', delta: '前文' } })
    emit({ sessionId: 'session-question', runId: 'run-question', event: { type: 'agent-question', question } })

    expect(useChat.getState().pendingQuestion?.questionId).toBe('question-1')
    expect(useChat.getState().waitingRunId).toBe('run-question')
    expect(useChat.getState().liveTimeline.some((item) => item.kind === 'text' && item.text === '前文')).toBe(true)
    expect(useChat.getState().liveTimeline.some((item) => item.kind === 'text' && item.text.includes('请选择方向'))).toBe(false)
    unsubscribe()
  })
})
