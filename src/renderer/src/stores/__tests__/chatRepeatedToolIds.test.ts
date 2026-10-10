import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, StoryFabricApi } from '../../../../shared/api'
import { installPlatformApi } from '../../platform/platformApi'
import { useChat } from '../chatStore'

afterEach(() => {
  useChat.getState().resetWorkspace()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function bindLiveEvents(): (event: AgentEventEnvelope['event']) => void {
  let listener: (envelope: AgentEventEnvelope) => void = () => { throw new Error('not bound') }
  installPlatformApi({ onAgentEvent: (callback: typeof listener) => { listener = callback; return () => undefined } } as unknown as StoryFabricApi)
  useChat.setState({ activeId: 'repeated', streaming: true, runningSessionId: 'repeated', runningSessionIds: ['repeated'], messages: [], liveTimeline: [], liveTools: [], error: null })
  useChat.getState().bindEvents()
  return (event) => listener({ sessionId: 'repeated', runId: 'repeated-run', event })
}

describe('repeated tool call IDs', () => {
  it('keeps completed calls unchanged when a new tool reuses the same call ID', () => {
    vi.useFakeTimers()
    const emit = bindLiveEvents()
    emit({ type: 'tool-start', callId: 'call_0', name: 'read_chapter', argsJson: 'first args '.repeat(2000) })
    emit({ type: 'tool-done', callId: 'call_0', ok: true, resultPreview: 'First result' })
    const first = useChat.getState().liveTimeline[0]
    const firstTool = useChat.getState().liveTools[0]

    emit({ type: 'tool-start', callId: 'call_0', name: 'append_chapter', argsJson: '' })
    emit({ type: 'tool-args-delta', callId: 'call_0', delta: '{"content":"second"}' })
    vi.advanceTimersByTime(20)
    emit({ type: 'tool-preview', callId: 'call_0', preview: 'Second preview' })

    expect(useChat.getState().liveTimeline).toEqual([
      first,
      { kind: 'tool', callId: 'call_0', name: 'append_chapter', argsJson: '{"content":"second"}', status: 'running', preview: 'Second preview' }
    ])
    expect(useChat.getState().liveTools[0]).toBe(firstTool)
    emit({ type: 'tool-done', callId: 'call_0', ok: false, resultPreview: 'Second failed' })
    expect(useChat.getState().liveTimeline[0]).toBe(first)
    expect(useChat.getState().liveTools[0]).toBe(firstTool)
    expect(useChat.getState().liveTimeline[1]).toMatchObject({ status: 'error', preview: 'Second failed' })
    expect(useChat.getState().liveTools[1]).toMatchObject({ status: 'error', preview: 'Second failed' })
  })

  it('appends a fresh occurrence even when both calls have identical names and arguments', () => {
    const emit = bindLiveEvents()
    emit({ type: 'tool-start', callId: 'call_0', name: 'read_chapter', argsJson: '{}' })
    emit({ type: 'tool-done', callId: 'call_0', ok: false, resultPreview: 'First failed' })
    const first = useChat.getState().liveTimeline[0]
    emit({ type: 'tool-start', callId: 'call_0', name: 'read_chapter', argsJson: '{}' })
    emit({ type: 'tool-start', callId: 'call_0', name: 'read_chapter', argsJson: '{}' })
    expect(useChat.getState().liveTimeline).toHaveLength(2)
    expect(useChat.getState().liveTimeline[1]).toMatchObject({ status: 'running' })
    emit({ type: 'tool-done', callId: 'call_0', ok: true, resultPreview: 'Retry succeeded' })
    expect(useChat.getState().liveTimeline[0]).toBe(first)
    expect(useChat.getState().liveTimeline[1]).toMatchObject({ status: 'ok', preview: 'Retry succeeded' })
  })

  it('updates repeated starts and write confirmation only on the latest active occurrence', () => {
    const emit = bindLiveEvents()
    emit({ type: 'tool-start', callId: 'call_0', name: 'append_chapter', argsJson: '{}' })
    emit({ type: 'tool-done', callId: 'call_0', ok: true, resultPreview: 'First saved' })
    const first = useChat.getState().liveTimeline[0]
    emit({ type: 'tool-start', callId: 'call_0', name: 'append_chapter', argsJson: '' })
    emit({ type: 'tool-start', callId: 'call_0', name: 'append_chapter', argsJson: '{"chapter":"second"}' })
    emit({ type: 'pending-change', change: { id: 'write-second', toolName: 'append_chapter', entityKind: 'chapter', entityId: 'second', title: 'Save chapter', beforeText: '', afterText: 'Second chapter' } })

    expect(useChat.getState().liveTimeline).toHaveLength(2)
    expect(useChat.getState().liveTimeline[0]).toBe(first)
    expect(useChat.getState().liveTimeline[1]).toMatchObject({ argsJson: '{"chapter":"second"}', status: 'pending', preview: '等待你确认写回' })
    expect(useChat.getState().liveTools[0]).toMatchObject({ status: 'ok', preview: 'First saved' })
    expect(useChat.getState().liveTools[1]).toMatchObject({ status: 'pending', preview: '等待你确认写回' })
  })
})
