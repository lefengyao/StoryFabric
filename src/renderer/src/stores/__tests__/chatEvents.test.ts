import { describe, expect, it } from 'vitest'
import type { AgentEventEnvelope } from '../../../../shared/api'
import type { ChatMessage, ChatSession } from '../../../../shared/types'
import { sessionEventPatch } from '../chatEvents'

function session(messages: ChatMessage[]): ChatSession {
  return { id: 'sess_1', title: '测试会话', createdAt: 1, updatedAt: 2, archived: false, messages }
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

  it('ignores session events from an inactive session', () => {
    const envelope: AgentEventEnvelope = {
      sessionId: 'sess_2',
      event: { type: 'session', session: session([{ id: 'msg_1', role: 'user', text: '后台消息' }]) }
    }

    expect(sessionEventPatch('sess_1', envelope)).toBeNull()
  })
})
