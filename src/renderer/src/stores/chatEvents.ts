import type { AgentEventEnvelope } from '../../../shared/api'
import type { AgentBudgetSnapshot, ChatMessage, ChatSession, OrchestrationRunRecord } from '../../../shared/types'

export interface SessionEventPatch {
  activeId?: string
  messages: ChatMessage[]
  orchestrationRuns?: OrchestrationRunRecord[]
  budget?: AgentBudgetSnapshot | null
}

export function sessionEventPatch(activeId: string | null, envelope: AgentEventEnvelope): SessionEventPatch | null {
  if (envelope.event.type !== 'session') return null
  if (activeId && envelope.sessionId !== activeId) return null
  const session = envelope.event.session
  const latestRun = session.orchestrationRuns?.at(-1)
  return {
    ...(activeId ? {} : { activeId: envelope.sessionId }),
    messages: session.messages,
    ...(session.orchestrationRuns !== undefined
      ? { orchestrationRuns: session.orchestrationRuns, budget: latestRun?.budget ?? null }
      : {})
  }
}

export function hasAssistantAfterLatestUser(session: ChatSession): boolean {
  const latestUser = session.messages.findLastIndex((message) => message.role === 'user')
  const latestAssistant = session.messages.findLastIndex((message) => message.role === 'assistant')
  return latestUser >= 0 && latestAssistant > latestUser
}
