import type { AgentEventEnvelope } from '../../../shared/api'
import type { ChatMessage, ChatSession } from '../../../shared/types'

export function sessionEventPatch(activeId: string | null, envelope: AgentEventEnvelope): { activeId?: string; messages: ChatMessage[] } | null {
  if (envelope.event.type !== 'session') return null
  if (activeId && envelope.sessionId !== activeId) return null
  return {
    ...(activeId ? {} : { activeId: envelope.sessionId }),
    messages: envelope.event.session.messages
  }
}

export function hasAssistantAfterLatestUser(session: ChatSession): boolean {
  const latestUser = session.messages.findLastIndex((message) => message.role === 'user')
  const latestAssistant = session.messages.findLastIndex((message) => message.role === 'assistant')
  return latestUser >= 0 && latestAssistant > latestUser
}
