import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatSession } from '../../../../shared/types'
import { approvalPolicyPickerDisabled, sessionScopePatch, shouldKeepStreamingAfterAcceptance, workspaceScopePatch } from '../chatScope'

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

  it('clears preferences and context metadata absent from the next session', () => {
    expect(sessionScopePatch(session)).toEqual(expect.objectContaining({
      creativePreferences: undefined,
      contextSummary: undefined,
      contextSummaryThrough: undefined,
      contextSummaryUpdatedAt: undefined
    }))
  })

  it('restores the latest orchestration budget when reopening a session', () => {
    const withRun: ChatSession = {
      ...session,
      orchestrationRuns: [{
        runId: 'run-1',
        status: 'completed',
        sourceRevision: 1,
        originalText: 'test',
        stages: [],
        artifacts: [],
        overlay: {},
        businessText: '',
        updatedAt: 3,
        budget: { maxCalls: 12, maxEstimatedTokens: 300000, callsStarted: 4, callsSettled: 4, actualTokens: 1200, estimatedTokens: 1500, reservedTokens: 0 }
      }]
    }

    expect(sessionScopePatch(withRun).budget).toEqual(withRun.orchestrationRuns?.[0].budget)
  })

  it('clears all session-local state when the workspace changes', () => {
    expect(workspaceScopePatch()).toEqual({
      activeId: null,
      messages: [],
      approvalPolicy: 'strict',
      creativePreferences: undefined,
      modelPreferences: [],
      orchestrationRuns: [],
      budget: null,
      streamingText: '',
      streaming: false,
      liveTimeline: [],
      liveTools: [],
      liveSkillEvents: [],
      liveRuleEvents: [],
      contextSummary: undefined,
      contextSummaryThrough: undefined,
      contextSummaryUpdatedAt: undefined,
      contextCompressing: false,
      contextCompression: null,
      pendingQuestion: null,
      pendingSkillCandidate: null,
      waitingRunId: null,
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

  it('keeps the approval policy picker editable for the next run while the current run streams', () => {
    expect(approvalPolicyPickerDisabled({ activeId: 'session-b', streaming: true })).toBe(false)
    expect(approvalPolicyPickerDisabled({ activeId: null, streaming: false })).toBe(true)
  })
})
