import { normalizeApprovalPolicy } from '../../shared/creative'
import type { ApprovalPolicy, ChatSession, ReasoningPreference, SessionModelPreference } from '../../shared/types'

export function getSessionApprovalPolicy(session: ChatSession): ApprovalPolicy {
  return normalizeApprovalPolicy(session.approvalPolicy)
}

export function setSessionApprovalPolicy(session: ChatSession, approvalPolicy: ApprovalPolicy): ChatSession {
  return { ...session, approvalPolicy, updatedAt: Date.now() }
}

export function getSessionModelPreference(session: ChatSession, providerId: string, model: string): ReasoningPreference {
  return session.modelPreferences?.find((item) => item.providerId === providerId && item.model === model)?.reasoning ?? 'inherit'
}

export function setSessionModelPreference(session: ChatSession, preference: SessionModelPreference): ChatSession {
  const current = session.modelPreferences ?? []
  const index = current.findIndex((item) => item.providerId === preference.providerId && item.model === preference.model)
  const modelPreferences = index < 0
    ? [...current, preference]
    : current.map((item, itemIndex) => itemIndex === index ? preference : item)
  return { ...session, modelPreferences, updatedAt: Date.now() }
}
