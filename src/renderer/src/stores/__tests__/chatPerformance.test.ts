import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, StoryFabricApi } from '../../../../shared/api'
import { installPlatformApi } from '../../platform/platformApi'
import { useChat } from '../chatStore'

afterEach(() => {
  useChat.getState().resetWorkspace()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function bindLiveEvents(): { emit: (event: AgentEventEnvelope['event']) => void; unsubscribe: () => void } {
  let listener: (envelope: AgentEventEnvelope) => void = () => { throw new Error('not bound') }
  installPlatformApi({ onAgentEvent: (callback: typeof listener) => { listener = callback; return () => undefined } } as unknown as StoryFabricApi)
  useChat.setState({ activeId: 'perf', streaming: true, runningSessionId: 'perf', runningSessionIds: ['perf'], messages: [], liveTimeline: [], liveTools: [], error: null })
  const unsubscribe = useChat.getState().bindEvents()
  return { emit: (event) => listener({ sessionId: 'perf', runId: 'perf-run', event }), unsubscribe }
}

describe('live tool rendering budget', () => {
  it('stops notifying subscribers once streamed arguments have reached the display limit', () => {
    vi.useFakeTimers()
    const { emit, unsubscribe } = bindLiveEvents()
    emit({ type: 'tool-start', callId: 'append', name: 'append_chapter', argsJson: '' })
    emit({ type: 'tool-args-delta', callId: 'append', delta: '章节正文'.repeat(10000) })
    vi.advanceTimersByTime(20)
    const before = useChat.getState().liveTimeline
    const updates = vi.fn()
    const unwatch = useChat.subscribe(updates)
    for (let frame = 0; frame < 20; frame += 1) {
      emit({ type: 'tool-args-delta', callId: 'append', delta: '继续正文'.repeat(200) })
      vi.advanceTimersByTime(20)
    }
    expect(updates.mock.calls.length).toBe(0)
    expect(useChat.getState().liveTimeline).toBe(before)
    emit({ type: 'tool-done', callId: 'append', ok: true, resultPreview: '已写入章节' })
    expect(useChat.getState().liveTools[0].status).toBe('ok')
    unwatch()
    unsubscribe()
  })

  it('ignores argument deltas for a missing tool row', () => {
    vi.useFakeTimers()
    const { emit, unsubscribe } = bindLiveEvents()
    const before = useChat.getState().liveTimeline
    const updates = vi.fn()
    const unwatch = useChat.subscribe(updates)
    emit({ type: 'tool-args-delta', callId: 'missing', delta: '正文' })
    vi.advanceTimersByTime(20)
    expect(updates.mock.calls.length).toBe(0)
    expect(useChat.getState().liveTimeline).toBe(before)
    unwatch()
    unsubscribe()
  })

  it('publishes a burst of text deltas only at the batch boundary', () => {
    vi.useFakeTimers()
    const { emit, unsubscribe } = bindLiveEvents()
    emit({ type: 'tool-start', callId: 'read', name: 'get_chapter', argsJson: '{}' })
    const updates = vi.fn()
    const unwatch = useChat.subscribe(updates)
    for (let chunk = 0; chunk < 100; chunk += 1) emit({ type: 'text-delta', messageId: 'chapter-reply', delta: '文' })
    expect(updates.mock.calls.length).toBe(0)
    vi.advanceTimersByTime(20)
    expect(updates.mock.calls.length).toBe(1)
    expect(useChat.getState().streamingText).toBe('文'.repeat(100))
    unwatch()
    unsubscribe()
  })

  it('does not notify the viewed session for background argument deltas after saturation', async () => {
    vi.useFakeTimers()
    const { emit, unsubscribe } = bindLiveEvents()
    emit({ type: 'tool-start', callId: 'append', name: 'append_chapter', argsJson: '正文'.repeat(10000) })
    const platform = await import('../../platform/platformApi')
    const api = platform.getPlatformApi()
    Object.assign(api, { loadSession: async () => ({ id: 'viewed', title: '另一会话', createdAt: 0, updatedAt: 0, archived: false, messages: [] }) })
    await useChat.getState().openSession('viewed')
    const updates = vi.fn()
    const unwatch = useChat.subscribe(updates)
    for (let frame = 0; frame < 20; frame += 1) {
      emit({ type: 'tool-args-delta', callId: 'append', delta: '继续正文'.repeat(200) })
      vi.advanceTimersByTime(20)
    }
    expect(updates.mock.calls.length).toBe(0)
    expect(useChat.getState().activeId).toBe('viewed')
    unwatch()
    unsubscribe()
  })

  it('opens write approval without relying on newer WebView array search APIs', () => {
    const { emit, unsubscribe } = bindLiveEvents()
    const findLastIndex = vi.spyOn(Array.prototype, 'findLastIndex').mockImplementation(() => { throw new Error('unsupported WebView API') })
    try {
      emit({ type: 'tool-start', callId: 'append', name: 'append_chapter', argsJson: '{}' })
      emit({ type: 'pending-change', change: { id: 'write', toolName: 'append_chapter', entityKind: 'chapter', entityId: 'chapter', title: '保存章节', beforeText: '', afterText: '正文' } })
      expect(useChat.getState().pendingChange?.id).toBe('write')
      expect(useChat.getState().liveTools[0].name).toBe('append_chapter')
      expect(useChat.getState().liveTimeline[0]).toMatchObject({ kind: 'tool', status: 'pending' })
    } finally {
      findLastIndex.mockRestore()
      unsubscribe()
    }
  })
})
