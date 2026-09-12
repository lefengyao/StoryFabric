import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, StoryFabricApi } from '../../../../shared/api'
import type { ChatMessage, ChatSession } from '../../../../shared/types'
import { installPlatformApi } from '../../platform/platformApi'
import { useChat } from '../chatStore'

const userMessage: ChatMessage = { id: 'user_1', role: 'user', text: '继续写第七章' }

function staleSession(): ChatSession {
  return {
    id: 'session_1',
    title: '测试会话',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [userMessage]
  }
}

afterEach(() => {
  useChat.getState().resetWorkspace()
  vi.restoreAllMocks()
})

describe('chat completion', () => {
  it('creates and activates a new session for the global sidebar', async () => {
    const session: ChatSession = {
      id: 'session_new',
      title: '新会话',
      createdAt: 2,
      updatedAt: 2,
      archived: false,
      messages: []
    }
    installPlatformApi({
      createSession: vi.fn(async () => session),
      listSessions: vi.fn(async () => [{ id: session.id, title: session.title, updatedAt: session.updatedAt, messageCount: 0, archived: false }])
    } as unknown as StoryFabricApi)

    await useChat.getState().newSession()

    expect(useChat.getState().activeId).toBe('session_new')
    expect(useChat.getState().sessions).toHaveLength(1)
  })

  it('keeps the streamed reply visible when the completed session reload is stale', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => {
      throw new Error('event listener was not bound')
    }
    installPlatformApi({
      loadSession: vi.fn(async () => staleSession()),
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => {
        emit = callback
        return () => undefined
      })
    } as unknown as StoryFabricApi)

    useChat.setState({
      activeId: 'session_1',
      messages: [userMessage],
      streaming: true,
      streamingText: '第七章已经补完。',
      liveTools: [],
      error: null
    })
    const unsubscribe = useChat.getState().bindEvents()

    emit({ sessionId: 'session_1', event: { type: 'done' } })

    await vi.waitFor(() => expect(useChat.getState().streaming).toBe(false))
    expect(useChat.getState().streamingText).toBe('第七章已经补完。')
    unsubscribe()
  })

  it('keeps text and tool activity in event order during a live turn', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => {
      throw new Error('event listener was not bound')
    }
    installPlatformApi({
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => {
        emit = callback
        return () => undefined
      })
    } as unknown as StoryFabricApi)

    useChat.setState({
      activeId: 'session_live',
      messages: [userMessage],
      streaming: true,
      streamingText: '',
      liveTimeline: [],
      liveTools: [],
      error: null
    })
    const unsubscribe = useChat.getState().bindEvents()

    emit({ sessionId: 'session_live', event: { type: 'text-delta', messageId: 'a1', delta: '先检查当前章节。' } })
    emit({ sessionId: 'session_live', event: { type: 'tool-start', callId: 'tool_1', name: 'get_chapter', argsJson: '{"id":"c1"}' } })
    emit({ sessionId: 'session_live', event: { type: 'tool-done', callId: 'tool_1', ok: true, resultPreview: '已读取章节' } })
    emit({ sessionId: 'session_live', event: { type: 'text-delta', messageId: 'a2', delta: '再给出修改建议。' } })

    await vi.waitFor(() => expect(useChat.getState().liveTimeline).toHaveLength(3))
    expect(useChat.getState().liveTimeline.map((item) => item.kind)).toEqual(['text', 'tool', 'text'])
    expect(useChat.getState().liveTimeline[2]).toMatchObject({ kind: 'text', text: '再给出修改建议。' })
    unsubscribe()
  })

  it('applies the final session carried by done without waiting for a disk reload', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => {
      throw new Error('event listener was not bound')
    }
    const stored = staleSession()
    const finalSession: ChatSession = {
      ...stored,
      updatedAt: 2,
      messages: [...stored.messages, { id: 'assistant_1', role: 'assistant', text: '第七章已经补完。' }]
    }
    installPlatformApi({
      loadSession: vi.fn(async () => stored),
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => {
        emit = callback
        return () => undefined
      })
    } as unknown as StoryFabricApi)

    useChat.setState({
      activeId: 'session_1',
      messages: [userMessage],
      streaming: true,
      streamingText: '第七章已经补完。',
      liveTools: [],
      error: null
    })
    const unsubscribe = useChat.getState().bindEvents()

    emit({
      sessionId: 'session_1',
      event: { type: 'done', session: finalSession } as AgentEventEnvelope['event']
    })

    await vi.waitFor(() => expect(useChat.getState().streaming).toBe(false))
    expect(useChat.getState().messages).toEqual(finalSession.messages)
    expect(useChat.getState().streamingText).toBe('')
    unsubscribe()
  })
})
