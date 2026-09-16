import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatSession } from '../../../../shared/types'
import { sessionScopePatch, shouldKeepStreamingAfterAcceptance, workspaceScopePatch } from '../chatScope'

const session: ChatSession = {
  id: 'session-b',
  title: 'B',
  createdAt: 1,
  updatedAt: 2,
  archived: false,
  messages: [{ id: 'm1', role: 'user', text: '历史消息' } as ChatMessage]
}

describe('chat scope transitions', () => {
  it('clears unsent references when opening another session', () => {
    expect(sessionScopePatch(session)).toMatchObject({
      activeId: 'session-b',
      messages: session.messages,
      modelPreferences: [],
      attachments: [],
      messageFiles: [],
      pendingChange: null,
      error: null
    })
  })

  it('clears all session-local state when the workspace changes', () => {
    expect(workspaceScopePatch()).toEqual({
      activeId: null,
      messages: [],
      modelPreferences: [],
      orchestrationRuns: [],
      budget: null,
      streamingText: '',
      streaming: false,
      liveTimeline: [],
      liveTools: [],
      contextSummary: undefined,
      contextSummaryThrough: undefined,
      contextSummaryUpdatedAt: undefined,
      contextCompressing: false,
      contextCompression: null,
      pendingChange: null,
      lastPendingChange: null,
      lastAppliedChange: null,
      attachments: [],
      messageFiles: [],
      error: null
    })
  })

  it('keeps the stop action available after an asynchronous run is accepted', () => {
    expect(shouldKeepStreamingAfterAcceptance({ accepted: true, done: false })).toBe(true)
    expect(shouldKeepStreamingAfterAcceptance({ accepted: true, done: true })).toBe(false)
  })
})
