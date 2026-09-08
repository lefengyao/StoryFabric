import type { AgentEventEnvelope } from '../../../shared/api'
import type { ChatMessage } from '../../../shared/types'

export function sessionEventPatch(activeId: string | null, envelope: AgentEventEnvelope): { activeId?: string; messages: ChatMessage[] } | null {
  if (envelope.event.type !== 'session') return null
  if (activeId && envelope.sessionId !== activeId) return null
  return {
    ...(activeId ? {} : { activeId: envelope.sessionId }),
    messages: envelope.event.session.messages
  }
}
