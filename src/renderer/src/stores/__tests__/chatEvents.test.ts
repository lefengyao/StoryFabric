import { describe, expect, it } from 'vitest'
import type { AgentEventEnvelope } from '../../../../shared/api'
import type { AgentBudgetSnapshot, ChatMessage, ChatSession, OrchestrationRunRecord } from '../../../../shared/types'
import { sessionEventPatch } from '../chatEvents'

function session(messages: ChatMessage[]): ChatSession {
  return { id: 'sess_1', title: '测试会话', createdAt: 1, updatedAt: 2, archived: false, messages }
}

function run(): OrchestrationRunRecord {
  const budget: AgentBudgetSnapshot = { maxCalls: 24, maxEstimatedTokens: 30_000_000, callsStarted: 3, callsSettled: 2, actualTokens: 1200, estimatedTokens: 1300, reservedTokens: 0 }
  return { runId: 'run-1', status: 'running', sourceRevision: 'r1', originalText: '', stages: [{ stageId: 'plan', status: 'running' }], artifacts: [], overlay: {}, businessText: '', updatedAt: 3, budget }
}

describe('chat session events', () => {
  it('updates the visible current session when a later user message arrives', () => {
    const messages: ChatMessage[] = [
      { id: 'msg_1', role: 'user', text: '第一条' },
      { id: 'msg_2', role: 'assistant', text: '第一条回答' },
      { id: 'msg_3', role: 'user', text: '第二条' }
    ]
    const envelope: AgentEventEnvelope = { sessionId: 'sess_1', event: { type: 'session', session: session(messages) } }

    expect(sessionEventPatch('sess_1', envelope)).toEqual({ messages })
  })

  it('adopts the session id and messages for the first streamed session event', () => {
    const messages: ChatMessage[] = [{ id: 'msg_1', role: 'user', text: '第一条' }]
    const envelope: AgentEventEnvelope = { sessionId: 'sess_1', event: { type: 'session', session: session(messages) } }

    expect(sessionEventPatch(null, envelope)).toEqual({ activeId: 'sess_1', messages })
  })

  it('keeps the live orchestration run and budget from a session event', () => {
    const messages: ChatMessage[] = [{ id: 'msg_1', role: 'user', text: '执行编排' }]
    const persistedRun = run()
    const envelope: AgentEventEnvelope = { sessionId: 'sess_1', event: { type: 'session', session: { ...session(messages), orchestrationRuns: [persistedRun] } } }

    expect(sessionEventPatch('sess_1', envelope)).toMatchObject({ messages, orchestrationRuns: [persistedRun], budget: persistedRun.budget })
  })

  it('ignores session events from an inactive session', () => {
    const envelope: AgentEventEnvelope = {
      sessionId: 'sess_2',
      event: { type: 'session', session: session([{ id: 'msg_1', role: 'user', text: '后台消息' }]) }
    }

    expect(sessionEventPatch('sess_1', envelope)).toBeNull()
  })
})
