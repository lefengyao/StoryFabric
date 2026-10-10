import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, StoryFabricApi } from '../../../../shared/api'
import type { ChatMessage, ChatSession } from '../../../../shared/types'
import { normalizeCreativePreferences } from '../../../../shared/creative'
import { installPlatformApi } from '../../platform/platformApi'
import { useChat } from '../chatStore'
import { chatDraftScope, chatDraftStore } from '../chatDraftStore'
import { useSettings } from '../settingsStore'
import { useWorkspace } from '../workspaceStore'

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
  useSettings.setState({ settings: null })
  useWorkspace.setState({ status: 'booting', summary: null, uiSource: null, error: null })
  chatDraftStore.dispose()
  vi.restoreAllMocks()
})

describe('chat completion', () => {
  it('calls native question and skill handlers with their platform instance', async () => {
    const native = {
      handled: [] as string[],
      async agentAnswerQuestion(answer: { questionId: string }): Promise<void> { this.handled.push(answer.questionId) },
      async agentResolveSkillCandidate(id: string): Promise<void> { this.handled.push(id) }
    }
    installPlatformApi(native as unknown as StoryFabricApi)
    useChat.setState({ pendingQuestion: {
      questionId: 'question_1', runId: 'run_1', sessionId: 'session_1', agentId: 'planner',
      title: '选择方向', description: '请选择', fields: [{ id: 'choice', label: '方向', type: 'single', required: true, options: [{ id: 'a', label: 'A' }] }]
    }, pendingSkillCandidate: { candidateId: 'candidate_1' } as never })

    await useChat.getState().answerQuestion({ questionId: 'question_1', answers: { choice: 'a' } })
    await useChat.getState().resolveSkillCandidate('candidate_1', 'reject')

    expect(native.handled).toEqual(['question_1', 'candidate_1'])
  })

  it('opens another session while the first run continues', async () => {
    const other: ChatSession = { ...staleSession(), id: 'session_2', title: '另一会话', messages: [{ id: 'other_user', role: 'user', text: '另一段对话' }] }
    const loadSession = vi.fn(async (id: string) => id === other.id ? other : staleSession())
    installPlatformApi({ loadSession } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_1', runningSessionId: 'session_1', streaming: true, messages: [userMessage] })

    await useChat.getState().openSession(other.id)

    expect(loadSession).toHaveBeenCalledWith(other.id)
    expect(useChat.getState().activeId).toBe(other.id)
    expect(useChat.getState().messages).toEqual(other.messages)
    expect(useChat.getState().runningSessionId).toBe('session_1')
  })

  it('finishes a background run without replacing the viewed session', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    const other: ChatSession = { ...staleSession(), id: 'session_2', title: '另一会话', messages: [{ id: 'other_user', role: 'user', text: '另一段对话' }] }
    const finished: ChatSession = { ...staleSession(), messages: [userMessage, { id: 'assistant_1', role: 'assistant', text: '已完成' }] }
    installPlatformApi({
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: other.id, runningSessionId: 'session_1', streaming: true, messages: other.messages, liveTimeline: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    emit({ sessionId: 'session_1', runId: 'run_1', event: { type: 'done', session: finished } })

    await vi.waitFor(() => expect(useChat.getState().streaming).toBe(false))
    expect(useChat.getState().activeId).toBe(other.id)
    expect(useChat.getState().messages).toEqual(other.messages)
    expect(useChat.getState().runningSessionId).toBeNull()
    unsubscribe()
  })

  it('keeps the viewed session live activity when another session finishes', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    const background: ChatSession = { ...staleSession(), messages: [userMessage, { id: 'assistant_background', role: 'assistant', text: '后台完成' }] }
    installPlatformApi({
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({
      activeId: 'session_2', runningSessionIds: ['session_1', 'session_2'], runningSessionId: 'session_2', streaming: true,
      messages: [], streamingText: '当前内容', liveTimeline: [{ kind: 'text', id: 'current', text: '当前内容' }], liveTools: [], error: null
    })
    const unsubscribe = useChat.getState().bindEvents()

    emit({ sessionId: 'session_1', runId: 'run_1', event: { type: 'done', session: background } })

    await vi.waitFor(() => expect(useChat.getState().runningSessionIds).toEqual(['session_2']))
    expect(useChat.getState().liveTimeline).toEqual([{ kind: 'text', id: 'current', text: '当前内容' }])
    expect(useChat.getState().streamingText).toBe('当前内容')
    unsubscribe()
  })

  it('aborts the running session when a different session is viewed', async () => {
    const agentAbort = vi.fn(async () => undefined)
    installPlatformApi({ agentAbort } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_2', runningSessionId: 'session_1', streaming: true })

    await useChat.getState().abort()

    expect(agentAbort).toHaveBeenCalledWith('session_1')
  })

  it('does not delete the running session while another session is viewed', async () => {
    const deleteSession = vi.fn(async () => undefined)
    installPlatformApi({ deleteSession } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_2', runningSessionId: 'session_1', streaming: true })

    await useChat.getState().removeSession('session_1')

    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('restores a background run question when returning to that session', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    installPlatformApi({
      loadSession: vi.fn(async (id: string) => ({ ...staleSession(), id })),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_1', runningSessionId: 'session_1', streaming: true, messages: [userMessage] })
    const unsubscribe = useChat.getState().bindEvents()
    await useChat.getState().openSession('session_2')
    const question = {
      questionId: 'question_1', runId: 'run_1', sessionId: 'session_1', agentId: 'planner',
      title: '选择方向', description: '请选择', fields: [{ id: 'choice', label: '方向', type: 'single' as const, required: true, options: [{ id: 'a', label: 'A' }] }]
    }
    emit({ sessionId: 'session_1', runId: 'run_1', event: { type: 'agent-question', question } })
    expect(useChat.getState().pendingQuestion).toBeNull()

    await useChat.getState().openSession('session_1')

    expect(useChat.getState().pendingQuestion?.questionId).toBe('question_1')
    expect(useChat.getState().waitingRunId).toBe('run_1')
    unsubscribe()
  })

  it('marks an unanswered run as needing attention after switching away', async () => {
    installPlatformApi({ loadSession: vi.fn(async (id: string) => ({ ...staleSession(), id })) } as unknown as StoryFabricApi)
    useChat.setState({
      activeId: 'session_1', runningSessionId: 'session_1', streaming: true,
      pendingQuestion: {
        questionId: 'question_1', runId: 'run_1', sessionId: 'session_1', agentId: 'planner',
        title: '选择方向', description: '请选择', fields: []
      }
    })

    await useChat.getState().openSession('session_2')

    expect(useChat.getState().backgroundAttentionSessionId).toBe('session_1')
  })

  it('marks a background approval as needing attention when it arrives after switching away', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    installPlatformApi({
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({
      activeId: 'session_2', runningSessionId: 'session_1', streaming: true,
      messages: [], liveTimeline: [], liveTools: [], error: null
    })
    const unsubscribe = useChat.getState().bindEvents()

    emit({
      sessionId: 'session_1', runId: 'run_1', event: {
        type: 'pending-change',
        change: { id: 'change_1', toolName: 'save_chapter', entityKind: 'chapter', entityId: 'chapter_1', title: '保存章节', beforeText: '', afterText: '正文' }
      }
    })

    expect(useChat.getState().backgroundAttentionSessionIds).toContain('session_1')
    unsubscribe()
  })

  it('does not apply a completed mode update to another session opened meanwhile', async () => {
    let finishUpdate!: () => void
    const updateSession = vi.fn(() => new Promise<void>((resolve) => { finishUpdate = resolve }))
    installPlatformApi({ updateSession } as unknown as StoryFabricApi)
    const basic = normalizeCreativePreferences({ mode: 'basic' })
    const orchestration = normalizeCreativePreferences({ mode: 'orchestration', orchestrationEnabled: true })
    useChat.setState({ activeId: 'first', creativePreferences: orchestration })

    const pending = useChat.getState().updateCreativePreferences(basic)
    useChat.setState({ activeId: 'second', creativePreferences: orchestration })
    finishUpdate()
    await pending

    expect(updateSession).toHaveBeenCalledWith('first', { creativePreferences: basic })
    expect(useChat.getState().creativePreferences).toEqual(orchestration)
  })

  it('syncs the current orchestration budget when opening an old session snapshot', async () => {
    const creativePreferences = {
      mode: 'orchestration' as const,
      orchestrationEnabled: true,
      subagentsEnabled: true,
      intensity: 'standard' as const,
      selectedSkillIds: [],
      selectedRuleSetIds: [],
      orchestration: {
        mode: 'multi' as const,
        enabled: true,
        subagentsEnabled: true,
        enabledStageIds: ['plan'],
        modelByStage: {},
        maxCalls: 24,
        maxEstimatedTokens: 300000
      }
    }
    const session: ChatSession = { ...staleSession(), creativePreferences }
    const updateSession = vi.fn(async () => undefined)
    installPlatformApi({ loadSession: vi.fn(async () => session), updateSession } as unknown as StoryFabricApi)
    useSettings.setState({ settings: { orchestrationDefaults: { mode: 'multi', enabled: true, subagentsEnabled: true, enabledStageIds: ['plan'], modelByStage: {}, maxCalls: 300, maxEstimatedTokens: 30000000 } } as never })

    await useChat.getState().openSession(session.id)

    expect(updateSession).toHaveBeenCalledWith(session.id, {
      creativePreferences: expect.objectContaining({ orchestration: expect.objectContaining({ maxCalls: 300, maxEstimatedTokens: 30000000 }) })
    })
    expect(useChat.getState().creativePreferences?.orchestration?.maxCalls).toBe(300)
  })

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

  it('runs multiple sessions concurrently without mixing their live events', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    const first = staleSession()
    const second: ChatSession = { ...staleSession(), id: 'session_2', title: '第二会话', messages: [] }
    const finishedFirst: ChatSession = { ...first, messages: [userMessage, { id: 'assistant_1', role: 'assistant', text: '第一项完成' }] }
    const finishedSecond: ChatSession = { ...second, messages: [{ id: 'user_2', role: 'user', text: '第二项问题' }, { id: 'assistant_2', role: 'assistant', text: '第二项完成' }] }
    const agentRun = vi.fn(async (request: { sessionId?: string }) => ({ sessionId: request.sessionId ?? 'session_1', runId: `run_${request.sessionId ?? 'session_1'}` }))
    installPlatformApi({
      agentRun,
      createSession: vi.fn(async () => second),
      listSessions: vi.fn(async () => [
        { id: first.id, title: first.title, updatedAt: first.updatedAt, messageCount: 1, archived: false },
        { id: second.id, title: second.title, updatedAt: second.updatedAt, messageCount: 0, archived: false }
      ]),
      loadSession: vi.fn(async (id: string) => id === second.id ? second : first),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: first.id, messages: first.messages, streaming: false, liveTimeline: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    await useChat.getState().send('第一项问题', { providerId: 'provider', model: 'model' })
    await useChat.getState().newSession()
    await useChat.getState().send('第二项问题', { providerId: 'provider', model: 'model' })

    expect(agentRun).toHaveBeenCalledTimes(2)
    expect(agentRun.mock.calls.map(([request]) => request.sessionId)).toEqual([first.id, second.id])
    expect(useChat.getState().runningSessionIds).toEqual(expect.arrayContaining([first.id, second.id]))

    emit({ sessionId: first.id, runId: `run_${first.id}`, event: { type: 'text-delta', messageId: 'assistant_1', delta: '第一项' } })
    emit({ sessionId: second.id, runId: `run_${second.id}`, event: { type: 'text-delta', messageId: 'assistant_2', delta: '第二项' } })
    await vi.waitFor(() => expect(useChat.getState().liveTimeline).toContainEqual(expect.objectContaining({ kind: 'text', text: '第二项' })))
    expect(useChat.getState().streamingText).toBe('第二项')

    emit({ sessionId: first.id, runId: `run_${first.id}`, event: { type: 'done', session: finishedFirst } })
    await vi.waitFor(() => expect(useChat.getState().runningSessionIds).toEqual([second.id]))
    expect(useChat.getState().activeId).toBe(second.id)
    expect(useChat.getState().streaming).toBe(true)
    expect(useChat.getState().runningSessionId).toBe(second.id)

    emit({ sessionId: second.id, runId: `run_${second.id}`, event: { type: 'done', session: finishedSecond } })
    await vi.waitFor(() => expect(useChat.getState().runningSessionIds).toEqual([]))
    expect(useChat.getState().streaming).toBe(false)
    unsubscribe()
  })

  it('allows a second no-run-id completion after the first request resolves late', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    const accepted: Array<(value: { sessionId: string }) => void> = []
    const firstCompleted: ChatSession = { ...staleSession(), messages: [userMessage, { id: 'assistant_first', role: 'assistant', text: '第一次完成' }] }
    const secondCompleted: ChatSession = { ...staleSession(), messages: [userMessage, { id: 'assistant_second', role: 'assistant', text: '第二次完成' }] }
    installPlatformApi({
      agentRun: vi.fn(() => new Promise<{ sessionId: string }>((resolve) => { accepted.push(resolve) })),
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_1', messages: [userMessage], streaming: false, liveTimeline: [], liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    const first = useChat.getState().send('第一次提问', { providerId: 'provider', model: 'model' })
    await vi.waitFor(() => expect(accepted).toHaveLength(1))
    emit({ sessionId: 'session_1', event: { type: 'done', session: firstCompleted } })
    await vi.waitFor(() => expect(useChat.getState().runningSessionIds).toEqual([]))
    accepted.shift()?.({ sessionId: 'session_1' })
    await first

    const second = useChat.getState().send('第二次提问', { providerId: 'provider', model: 'model' })
    await vi.waitFor(() => expect(accepted).toHaveLength(1))
    accepted.shift()?.({ sessionId: 'session_1' })
    await second
    expect(useChat.getState().runningSessionIds).toEqual(['session_1'])

    emit({ sessionId: 'session_1', event: { type: 'done', session: secondCompleted } })
    await vi.waitFor(() => expect(useChat.getState().runningSessionIds).toEqual([]))
    unsubscribe()
  })

  it('does not let a late rejection from an old run clear a newer run', async () => {
    let rejectFirst!: (error: Error) => void
    let calls = 0
    const agentRun = vi.fn(() => {
      calls += 1
      if (calls === 1) return new Promise<{ sessionId: string }>((_, reject) => { rejectFirst = reject })
      return Promise.resolve({ sessionId: 'session_1' })
    })
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    const completed: ChatSession = { ...staleSession(), messages: [userMessage, { id: 'assistant_old', role: 'assistant', text: '旧运行完成' }] }
    installPlatformApi({
      agentRun,
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_1', messages: [userMessage], streaming: false, liveTimeline: [], liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    const first = useChat.getState().send('旧运行', { providerId: 'provider', model: 'model' })
    await vi.waitFor(() => expect(agentRun).toHaveBeenCalledTimes(1))
    emit({ sessionId: 'session_1', event: { type: 'done', session: completed } })
    await vi.waitFor(() => expect(useChat.getState().runningSessionIds).toEqual([]))

    const second = useChat.getState().send('新运行', { providerId: 'provider', model: 'model' })
    await vi.waitFor(() => expect(agentRun).toHaveBeenCalledTimes(2))
    await second
    expect(useChat.getState().runningSessionIds).toEqual(['session_1'])

    rejectFirst(new Error('旧请求失败'))
    await first
    expect(useChat.getState().runningSessionIds).toEqual(['session_1'])
    unsubscribe()
  })

  it('ignores an old run completion replayed before the next run is accepted', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    let resolveSecond!: (value: { sessionId: string; runId: string }) => void
    let calls = 0
    const agentRun = vi.fn(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ sessionId: 'session_1', runId: 'run_old' })
        : new Promise<{ sessionId: string; runId: string }>((resolve) => { resolveSecond = resolve })
    })
    const completed: ChatSession = { ...staleSession(), messages: [userMessage, { id: 'assistant_old', role: 'assistant', text: '旧运行完成' }] }
    installPlatformApi({
      agentRun,
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_1', messages: [userMessage], streaming: false, liveTimeline: [], liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    await useChat.getState().send('旧运行', { providerId: 'provider', model: 'model' })
    emit({ sessionId: 'session_1', runId: 'run_old', event: { type: 'done', session: completed } })
    await vi.waitFor(() => expect(useChat.getState().runningSessionIds).toEqual([]))

    const second = useChat.getState().send('新运行', { providerId: 'provider', model: 'model' })
    await vi.waitFor(() => expect(agentRun).toHaveBeenCalledTimes(2))
    emit({ sessionId: 'session_1', runId: 'run_old', event: { type: 'done', session: completed } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useChat.getState().runningSessionIds).toEqual(['session_1'])

    resolveSecond({ sessionId: 'session_1', runId: 'run_new' })
    await second
    unsubscribe()
  })

  it('preserves the last applied change when a run finishes with its final session', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => undefined
    const appliedChange = { entityKind: 'chapter' as const, entityId: 'chapter_1' }
    const completed: ChatSession = { ...staleSession(), messages: [userMessage, { id: 'assistant_done', role: 'assistant', text: '完成' }] }
    installPlatformApi({
      listSessions: vi.fn(async () => []),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({
      activeId: 'session_1', messages: [userMessage], streaming: true, runningSessionId: 'session_1',
      streamingText: '实时内容', liveTimeline: [], liveTools: [], lastAppliedChange: appliedChange, error: null
    })
    const unsubscribe = useChat.getState().bindEvents()

    emit({ sessionId: 'session_1', event: { type: 'done', session: completed } })

    await vi.waitFor(() => expect(useChat.getState().streaming).toBe(false))
    expect(useChat.getState().lastAppliedChange).toEqual(appliedChange)
    unsubscribe()
  })

  it('can stop a running archived session by its session id before deletion', async () => {
    const agentAbort = vi.fn(async () => undefined)
    installPlatformApi({ agentAbort } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'archived-running', streaming: true, messages: [], liveTools: [], error: null })

    await useChat.getState().stopSession('archived-running')

    expect(agentAbort).toHaveBeenCalledWith('archived-running')
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

  it('keeps a long save_chapter tool call bounded in the live UI', () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => { throw new Error('event listener was not bound') }
    installPlatformApi({
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)

    useChat.setState({ activeId: 'session_live', messages: [userMessage], streaming: true, streamingText: '', liveTimeline: [], liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()
    emit({ sessionId: 'session_live', event: { type: 'tool-start', callId: 'save-1', name: 'save_chapter', argsJson: '' } })
    for (let index = 0; index < 200; index += 1) {
      emit({ sessionId: 'session_live', event: { type: 'tool-args-delta', callId: 'save-1', delta: 'x'.repeat(100) } })
    }
    emit({ sessionId: 'session_live', event: { type: 'tool-start', callId: 'save-1', name: 'save_chapter', argsJson: 'x'.repeat(20000) } })

    const item = useChat.getState().liveTimeline.find((entry) => entry.kind === 'tool')
    expect(item?.kind).toBe('tool')
    if (item?.kind === 'tool') expect(item.argsJson.length).toBeLessThanOrEqual(12000)
    unsubscribe()
  })

  it('refreshes the workspace when an auto-approved mutation has committed', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => { throw new Error('event listener was not bound') }
    const refreshed = {
      name: 'A', path: '/A', characters: [], relationships: [], outline: [], events: [], settings: [], notes: [],
      chapters: [{ id: 'cha_1', title: '新章节', volume: '第一卷', order: 1, status: 'draft' as const, wordCount: 4, box: 'draft' as const }]
    }
    const refreshWorkspace = vi.fn(async () => refreshed)
    installPlatformApi({
      refreshWorkspace,
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'ready', summary: { ...refreshed, chapters: [] }, uiSource: 'electron-local', error: null })
    useChat.setState({ activeId: 'session_live', messages: [userMessage], streaming: true, liveTimeline: [], liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    emit({
      sessionId: 'session_live',
      event: {
        type: 'change-result', changeId: 'change_1', status: 'applied', message: '已保存章节',
        appliedChange: { entityKind: 'chapter', entityId: 'cha_1' }
      }
    })

    await vi.waitFor(() => expect(useWorkspace.getState().summary?.chapters.map((chapter) => chapter.id)).toEqual(['cha_1']))
    expect(refreshWorkspace).toHaveBeenCalledTimes(1)
    expect(useChat.getState().lastAppliedChange).toEqual({ entityKind: 'chapter', entityId: 'cha_1' })
    unsubscribe()
  })

  it('coalesces a burst of committed changes into one workspace refresh', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => { throw new Error('event listener was not bound') }
    const refreshed = { name: 'A', path: '/A', characters: [], relationships: [], outline: [], events: [], chapters: [], settings: [], notes: [] }
    const refreshWorkspace = vi.fn(async () => refreshed)
    installPlatformApi({
      refreshWorkspace,
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'ready', summary: refreshed, uiSource: 'electron-local', error: null })
    useChat.setState({ activeId: 'session_live', messages: [userMessage], streaming: true, liveTimeline: [], liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    for (const id of ['cha_1', 'cha_2', 'cha_3']) {
      emit({
        sessionId: 'session_live',
        event: { type: 'change-result', changeId: `change_${id}`, status: 'applied', message: '已保存章节', appliedChange: { entityKind: 'chapter', entityId: id } }
      })
    }

    await vi.waitFor(() => expect(refreshWorkspace).toHaveBeenCalledTimes(1))
    unsubscribe()
  })

  it('waits for the committed change result instead of refreshing when strict approval is merely accepted', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => { throw new Error('event listener was not bound') }
    const refreshWorkspace = vi.fn(async () => ({ name: 'A', path: '/A', characters: [], relationships: [], outline: [], events: [], chapters: [], settings: [], notes: [] }))
    const agentConfirm = vi.fn(async () => undefined)
    installPlatformApi({
      agentConfirm,
      refreshWorkspace,
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'ready', summary: { name: 'A', path: '/A', characters: [], relationships: [], outline: [], events: [], chapters: [] }, uiSource: 'electron-local', error: null })
    useChat.setState({
      activeId: 'session_live', messages: [userMessage], streaming: true, liveTimeline: [], liveTools: [], error: null,
      pendingChange: { id: 'change_1', toolName: 'save_chapter', entityKind: 'chapter', entityId: 'cha_1', title: '保存章节', beforeText: '', afterText: '正文' }
    })
    const unsubscribe = useChat.getState().bindEvents()

    await useChat.getState().confirmChange(true)

    expect(agentConfirm).toHaveBeenCalledWith('session_live', 'change_1', true)
    expect(refreshWorkspace).not.toHaveBeenCalled()

    emit({
      sessionId: 'session_live',
      event: {
        type: 'change-result', changeId: 'change_1', status: 'applied', message: '已保存章节',
        appliedChange: { entityKind: 'chapter', entityId: 'cha_1' }
      }
    })

    await vi.waitFor(() => expect(refreshWorkspace).toHaveBeenCalledTimes(1))
    unsubscribe()
  })

  it('ignores late events from an older run in the same session', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => { throw new Error('event listener was not bound') }
    installPlatformApi({
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    } as unknown as StoryFabricApi)
    useChat.setState({ activeId: 'session_live', messages: [userMessage], streaming: true, streamingText: '', liveTimeline: [], liveTools: [], error: null })
    const unsubscribe = useChat.getState().bindEvents()

    emit({ sessionId: 'session_live', runId: 'run-current', event: { type: 'text-delta', messageId: 'current', delta: '当前' } })
    emit({ sessionId: 'session_live', runId: 'run-old', event: { type: 'text-delta', messageId: 'old', delta: '旧结果' } })

    await vi.waitFor(() => expect(useChat.getState().liveTimeline).toHaveLength(1))
    expect(useChat.getState().streamingText).toBe('当前')
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

  it('clears only the sent draft when the session event arrives before agentRun resolves', async () => {
    let emit: (envelope: AgentEventEnvelope) => void = () => { throw new Error('event listener was not bound') }
    let resolveRun: ((value: { sessionId: string }) => void) | undefined
    const initial: ChatSession = { ...staleSession(), messages: [] }
    const accepted: ChatSession = { ...initial, messages: [{ id: 'new_user', role: 'user', text: '原问题' }] }
    const api = {
      agentRun: vi.fn(() => new Promise<{ sessionId: string }>((resolve) => { resolveRun = resolve })),
      onAgentEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => { emit = callback; return () => undefined })
    }
    installPlatformApi(api as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'ready', summary: { name: 'A', path: '/A', characters: [], relationships: [], outline: [], events: [], chapters: [] }, uiSource: 'electron-local', error: null })
    useChat.setState({ activeId: null, messages: [], streaming: false, liveTimeline: [], liveTools: [], error: null })
    const draftScope = chatDraftScope({ source: 'electron-local', path: '/A' }, null)
    chatDraftStore.setText(draftScope, '原问题')
    const unsubscribe = useChat.getState().bindEvents()
    const sending = useChat.getState().send('原问题', { providerId: 'p', model: 'm' })
    emit({ sessionId: 'session_new', event: { type: 'session', session: accepted } })
    expect(chatDraftStore.getText(chatDraftScope({ source: 'electron-local', path: '/A' }, 'session_new'))).toBe('')
    resolveRun?.({ sessionId: 'session_new' })
    await sending
    unsubscribe()
  })

  it('restores the original draft on a request-start failure without overwriting the next draft', async () => {
    const api = { agentRun: vi.fn(async () => { throw new Error('启动失败') }) }
    installPlatformApi(api as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'ready', summary: { name: 'A', path: '/A', characters: [], relationships: [], outline: [], events: [], chapters: [] }, uiSource: 'electron-local', error: null })
    const draftScope = chatDraftScope({ source: 'electron-local', path: '/A' }, 'session_1')
    useChat.setState({ activeId: 'session_1', messages: [], streaming: false, liveTimeline: [], liveTools: [], error: null })
    chatDraftStore.setText(draftScope, '原问题')
    await useChat.getState().send('原问题', { providerId: 'p', model: 'm' })
    expect(chatDraftStore.getText(draftScope)).toBe('原问题')
    chatDraftStore.setText(draftScope, '下一条')
    await useChat.getState().send('下一条', { providerId: 'p', model: 'm' })
    expect(chatDraftStore.getText(draftScope)).toBe('下一条')
  })

  it('does not let an older session load win a rapid session switch', async () => {
    const resolvers = new Map<string, (session: ChatSession) => void>()
    const api = {
      loadSession: vi.fn((id: string) => new Promise<ChatSession>((resolve) => { resolvers.set(id, resolve) }))
    }
    installPlatformApi(api as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'ready', summary: { name: 'A', path: '/A', characters: [], relationships: [], outline: [], events: [], chapters: [] }, uiSource: 'electron-local', error: null })
    useChat.setState({ activeId: null, messages: [], streaming: false, liveTimeline: [], liveTools: [], error: null })
    const first = useChat.getState().openSession('one')
    const second = useChat.getState().openSession('two')
    resolvers.get('one')?.({ ...staleSession(), id: 'one', messages: [{ ...userMessage, id: 'one-user' }] })
    resolvers.get('two')?.({ ...staleSession(), id: 'two', messages: [{ ...userMessage, id: 'two-user' }] })
    await Promise.all([first, second])
    expect(useChat.getState().activeId).toBe('two')
    expect(useChat.getState().messages[0]?.id).toBe('two-user')
  })
})
