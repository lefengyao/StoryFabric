import type { ChatMessage, ChatSession, OrchestrationRunRecord, SessionModelPreference } from '../../../shared/types'

export interface SessionScopePatch {
  activeId: string
  messages: ChatMessage[]
  modelPreferences?: SessionModelPreference[]
  orchestrationRuns?: OrchestrationRunRecord[]
  budget: null
  streamingText: string
  liveTimeline: []
  liveTools: []
  contextSummary?: string
  contextSummaryThrough?: string
  contextSummaryUpdatedAt?: number
  contextCompressing: false
  pendingChange: null
  attachments: []
  messageFiles: []
  error: null
}

export interface WorkspaceScopePatch {
  activeId: null
  messages: []
  modelPreferences: []
  orchestrationRuns: []
  budget: null
  streamingText: string
  streaming: false
  liveTimeline: []
  liveTools: []
  contextSummary: undefined
  contextSummaryThrough: undefined
  contextSummaryUpdatedAt: undefined
  contextCompressing: false
  contextCompression: null
  pendingChange: null
  lastPendingChange: null
  lastAppliedChange: null
  attachments: []
  messageFiles: []
  error: null
}

export function sessionScopePatch(session: ChatSession): SessionScopePatch {
  return {
    activeId: session.id,
    messages: session.messages,
  modelPreferences: session.modelPreferences ?? [],
    budget: null,
    orchestrationRuns: session.orchestrationRuns ?? [],
    streamingText: '',
    liveTimeline: [],
    liveTools: [],
    ...(session.contextSummary ? { contextSummary: session.contextSummary } : {}),
    ...(session.contextSummaryThrough ? { contextSummaryThrough: session.contextSummaryThrough } : {}),
    ...(session.contextSummaryUpdatedAt ? { contextSummaryUpdatedAt: session.contextSummaryUpdatedAt } : {}),
    contextCompressing: false,
    pendingChange: null,
    attachments: [],
    messageFiles: [],
    error: null
  }
}

export function workspaceScopePatch(): WorkspaceScopePatch {
  return {
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
  }
}

export function shouldKeepStreamingAfterAcceptance({ accepted, done }: { accepted: boolean; done: boolean }): boolean {
  return accepted && !done
}
