import { create } from 'zustand'
import type { AgentEventEnvelope } from '../../../shared/api'
import type {
  Attachment,
  ApprovalPolicy,
  ChatMessage,
  ChatSession,
  AgentBudgetSnapshot,
  AppliedChange,
  MessageFile,
  PendingChange,
  RunAgentRequest,
  SessionMeta,
  SessionModelPreference
} from '../../../shared/types'
import { DEFAULT_CREATIVE_PREFERENCES, type CreativePreferences } from '../../../shared/creative'
import { isChapterTextCandidatePurpose } from '../../../shared/agentTask'
import type { AgentQuestion, AgentQuestionAnswer, SkillCandidate, SkillCandidateAction } from '../../../shared/agentQuestions'
import type { RuleApplicationEvent, SkillApplicationEvent } from '../../../shared/agentEvidence'
import { useWorkspace } from './workspaceStore'
import type { ToolCallData } from '../../../shared/types'
import { getPlatformApi } from '../platform/platformApi'
import { hasAssistantAfterLatestUser, sessionEventPatch } from './chatEvents'
import { playCompletionSound, shouldPlayCompletionSound } from '../lib/completionSound'
import { createRafBatcher } from '../lib/rafBatcher'
import { useSettings } from './settingsStore'
import { onSettingsUpdated } from './settingsStore'
import { sessionScopePatch, shouldKeepStreamingAfterAcceptance, workspaceScopePatch } from './chatScope'
import { chatDraftScope, chatDraftStore, type DraftSendTransaction } from './chatDraftStore'
import { getPlatformUiSource } from '../platform/platformApi'
import { appendTextDelta } from '../lib/agentMessageReducer'
import { syncOrchestrationBudget } from '../lib/creativePreferences'

/** 流式期间的临时工具调用展示项 */
export interface LiveToolRun {
  callId: string
  name: string
  argsJson: string
  status: 'running' | 'pending' | 'ok' | 'error'
  preview?: string
}

export type LiveTurnItem =
  | { kind: 'text'; id: string; text: string; messageId?: string }
  | { kind: 'tool'; callId: string; name: string; argsJson: string; status: LiveToolRun['status']; preview?: string }
  | { kind: 'stage'; id: string; stageId: string; status: 'running' | 'completed' | 'failed' }

interface ChatState {
  sessions: SessionMeta[]
  activeId: string | null
  messages: ChatMessage[]
  approvalPolicy: ApprovalPolicy
  creativePreferences?: CreativePreferences
  modelPreferences: SessionModelPreference[]
  orchestrationRuns: import('../../../shared/types').OrchestrationRunRecord[]
  budget: AgentBudgetSnapshot | null
  /** 正在流式生成的助手草稿 */
  streamingText: string
  streaming: boolean
  /** The run can continue while a different session is being viewed. */
  runningSessionId: string | null
  /** All sessions with an active model run. */
  runningSessionIds: string[]
  backgroundAttentionSessionId: string | null
  backgroundAttentionSessionIds: string[]
  liveTimeline: LiveTurnItem[]
  liveTools: LiveToolRun[]
  liveSkillEvents: SkillApplicationEvent[]
  liveRuleEvents: RuleApplicationEvent[]
  contextSummary?: string
  contextSummaryThrough?: string
  contextSummaryUpdatedAt?: number
  contextCompressing: boolean
  contextCompression: { beforeTokens: number; afterTokens: number; summarizedMessages: number; at: number } | null
  pendingQuestion: AgentQuestion | null
  pendingSkillCandidate: SkillCandidate | null
  waitingRunId: string | null
  pendingChange: PendingChange | null
  /** 最近一次推送给用户确认的变更（change-applied 时据此识别） */
  lastPendingChange: PendingChange | null
  /** 最近一次已落盘的变更（供编辑页联动重载） */
  lastAppliedChange: AppliedChange | null
  attachments: Attachment[]
  messageFiles: MessageFile[]
  error: string | null

  initSessions: () => Promise<void>
  openSession: (id: string) => Promise<void>
  newSession: () => Promise<void>
  removeSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  setArchived: (id: string, archived: boolean) => Promise<void>
  setAttachments: (a: Attachment[]) => void
  setMessageFiles: (files: MessageFile[]) => void
  updateModelPreference: (value: SessionModelPreference) => Promise<void>
  updateApprovalPolicy: (value: ApprovalPolicy) => Promise<void>
  updateCreativePreferences: (value: CreativePreferences) => Promise<void>
  resetWorkspace: () => void

  send: (text: string, req: Omit<RunAgentRequest, 'message' | 'sessionId' | 'attachments'> & { creative?: CreativePreferences }) => Promise<void>
  confirmChange: (approved: boolean) => Promise<void>
  answerQuestion: (answer: AgentQuestionAnswer) => Promise<void>
  resolveSkillCandidate: (candidateId: string, action: SkillCandidateAction) => Promise<void>
  compressContext: () => Promise<void>
  stopSession: (id: string) => Promise<void>
  abort: () => Promise<void>

  /** 全局事件订阅（App 挂载时调用一次） */
  bindEvents: () => () => void
}

type SetFn = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void

type PendingDraftSend = DraftSendTransaction & { sessionId: string | null; beforeMessageIds: Set<string>; confirmed: boolean }
type SessionRunView = Pick<ChatState,
  | 'streamingText'
  | 'liveTimeline'
  | 'liveTools'
  | 'liveSkillEvents'
  | 'liveRuleEvents'
  | 'contextCompressing'
  | 'contextCompression'
  | 'pendingQuestion'
  | 'pendingSkillCandidate'
  | 'waitingRunId'
  | 'pendingChange'
  | 'lastPendingChange'
  | 'lastAppliedChange'
  | 'error'
>

const runningSessions = new Set<string>()
const runIdsBySession = new Map<string, string>()
const runViews = new Map<string, SessionRunView>()
const pendingDraftSends = new Map<string, PendingDraftSend>()
const backgroundAttentionSessions = new Set<string>()
const finishingRuns = new Set<string>()
const lastCompletedRunIds = new Map<string, string>()
let workspaceGeneration = 0
let sessionLoadGeneration = 0

function emptyRunView(): SessionRunView {
  return {
    streamingText: '',
    liveTimeline: [],
    liveTools: [],
    liveSkillEvents: [],
    liveRuleEvents: [],
    contextCompressing: false,
    contextCompression: null,
    pendingQuestion: null,
    pendingSkillCandidate: null,
    waitingRunId: null,
    pendingChange: null,
    lastPendingChange: null,
    lastAppliedChange: null,
    error: null
  }
}

function saveRunView(sessionId: string, state: ChatState): void {
  if (!runningSessions.has(sessionId)) return
  const {
    streamingText, liveTimeline, liveTools, liveSkillEvents, liveRuleEvents,
    contextCompressing, contextCompression, pendingQuestion, pendingSkillCandidate,
    waitingRunId, pendingChange, lastPendingChange, lastAppliedChange, error
  } = state
  runViews.set(sessionId, {
    streamingText, liveTimeline, liveTools, liveSkillEvents, liveRuleEvents,
    contextCompressing, contextCompression, pendingQuestion, pendingSkillCandidate,
    waitingRunId, pendingChange, lastPendingChange, lastAppliedChange, error
  })
}

function runIndicatorPatch(activeId: string | null): Pick<ChatState, 'runningSessionId' | 'runningSessionIds' | 'backgroundAttentionSessionId' | 'backgroundAttentionSessionIds' | 'streaming'> {
  const runningSessionIds = [...runningSessions]
  const backgroundAttentionSessionIds = [...backgroundAttentionSessions]
  return {
    runningSessionIds,
    backgroundAttentionSessionIds,
    runningSessionId: activeId && runningSessions.has(activeId) ? activeId : runningSessionIds[0] ?? null,
    backgroundAttentionSessionId: backgroundAttentionSessionIds.find((id) => id !== activeId) ?? null,
    streaming: Boolean(activeId && runningSessions.has(activeId))
  }
}

function hasActiveRun(sessionId: string | null, state: ChatState): boolean {
  if (!sessionId) return false
  return runningSessions.has(sessionId) || state.runningSessionIds.includes(sessionId) || (state.streaming && state.runningSessionId === sessionId)
}

function hydrateLegacyRunState(state: ChatState): void {
  for (const sessionId of state.runningSessionIds) runningSessions.add(sessionId)
  if (state.streaming) {
    const sessionId = state.runningSessionId ?? state.activeId
    if (sessionId) runningSessions.add(sessionId)
  }
}

function preserveActiveRunView(state: ChatState): void {
  hydrateLegacyRunState(state)
  if (state.activeId && runningSessions.has(state.activeId)) saveRunView(state.activeId, state)
}

function currentDraftScope(activeId: string | null): ReturnType<typeof chatDraftScope> {
  const workspace = useWorkspace.getState()
  return chatDraftScope({
    source: workspace.uiSource ?? getPlatformUiSource(),
    path: workspace.summary?.path ?? ''
  }, activeId)
}

async function reloadSessions(set: (p: Partial<ChatState>) => void, generation = workspaceGeneration): Promise<SessionMeta[]> {
  const platform = getPlatformApi()
  try {
    const sessions = await platform.listSessions()
    if (generation !== workspaceGeneration || getPlatformApi() !== platform) return []
    set({ sessions })
    return sessions
  } catch {
    return []
  }
}

export const useChat = create<ChatState>((set, get) => ({
  sessions: [],
  activeId: null,
  messages: [],
  approvalPolicy: 'strict',
  creativePreferences: undefined,
  modelPreferences: [],
  orchestrationRuns: [],
  budget: null,
  streamingText: '',
  streaming: false,
  runningSessionId: null,
  runningSessionIds: [],
  backgroundAttentionSessionId: null,
  backgroundAttentionSessionIds: [],
  liveTimeline: [],
  liveTools: [],
  liveSkillEvents: [],
  liveRuleEvents: [],
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
  error: null,

  initSessions: async () => {
    const generation = workspaceGeneration
    await reloadSessions(set, generation)
    if (generation !== workspaceGeneration) return
    const first = get().sessions[0]
    const pendingDraft = chatDraftStore.getText(currentDraftScope(null))
    if (first && !get().activeId && !pendingDraft) await get().openSession(first.id)
  },

  openSession: async (id) => {
    const generation = workspaceGeneration
    const request = ++sessionLoadGeneration
    const platform = getPlatformApi()
    const s = await platform.loadSession(id)
    if (generation !== workspaceGeneration || request !== sessionLoadGeneration || getPlatformApi() !== platform) return
    if (!s) return
    const synced = await syncSessionOrchestrationBudget(s).catch(() => s)
    if (generation !== workspaceGeneration || request !== sessionLoadGeneration || getPlatformApi() !== platform) return
    const current = get()
    if (current.activeId) {
      flushStreamingDelta(current.activeId)
      flushToolArgsDelta(current.activeId)
      preserveActiveRunView(get())
      if (current.activeId !== id && hasActiveRun(current.activeId, current) && (current.pendingQuestion || current.pendingSkillCandidate || current.pendingChange)) {
        backgroundAttentionSessions.add(current.activeId)
      }
    }
    const view = runViews.get(id) ?? emptyRunView()
    backgroundAttentionSessions.delete(id)
    set({
      ...sessionScopePatch(synced),
      ...view,
      pendingChange: view.pendingChange ?? synced.pendingChange ?? null,
      ...runIndicatorPatch(id)
    })
  },

  newSession: async () => {
    const generation = workspaceGeneration
    ++sessionLoadGeneration
    const platform = getPlatformApi()
    try {
      const session = await platform.createSession()
      if (generation !== workspaceGeneration || getPlatformApi() !== platform) return
      const current = get()
      if (current.activeId) {
        flushStreamingDelta(current.activeId)
        flushToolArgsDelta(current.activeId)
        preserveActiveRunView(get())
      }
      backgroundAttentionSessions.delete(session.id)
      set({ ...sessionScopePatch(session), ...emptyRunView(), ...runIndicatorPatch(session.id) })
      await reloadSessions(set, generation)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  removeSession: async (id) => {
    hydrateLegacyRunState(get())
    if (runningSessions.has(id)) {
      set({ error: '请先停止运行，再删除会话' })
      return
    }
    const generation = workspaceGeneration
    const platform = getPlatformApi()
    try {
      await platform.deleteSession(id)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return
    }
    if (generation !== workspaceGeneration || getPlatformApi() !== platform) return
    await reloadSessions(set, generation)
    if (get().activeId === id) get().newSession()
  },

  renameSession: async (id, title) => {
    const t = title.trim()
    if (!t) return
    await getPlatformApi().updateSession(id, { title: t })
    await reloadSessions(set)
  },

  setArchived: async (id, archived) => {
    const generation = workspaceGeneration
    const platform = getPlatformApi()
    await platform.updateSession(id, { archived })
    if (generation !== workspaceGeneration || getPlatformApi() !== platform) return
    await reloadSessions(set, generation)
    if (archived && get().activeId === id) get().newSession()
  },

  setAttachments: (attachments) => set({ attachments }),
  setMessageFiles: (messageFiles) => set({ messageFiles }),

  updateModelPreference: async (value) => {
    const id = get().activeId
    if (!id) throw new Error('请先创建或打开会话')
    await getPlatformApi().updateSessionModelPreference(id, value)
    set((state) => ({ modelPreferences: [...state.modelPreferences.filter((item) => !(item.providerId === value.providerId && item.model === value.model)), value] }))
  },

  updateApprovalPolicy: async (value) => {
    const id = get().activeId
    if (!id) throw new Error('请先创建或打开会话')
    await getPlatformApi().updateSession(id, { approvalPolicy: value })
    if (get().activeId === id) set({ approvalPolicy: value })
  },

  updateCreativePreferences: async (value) => {
    const id = get().activeId
    if (!id) throw new Error('请先创建或打开会话')
    await getPlatformApi().updateSession(id, { creativePreferences: value })
    if (get().activeId === id) set({ creativePreferences: value })
  },

  resetWorkspace: () => {
    workspaceGeneration += 1
    sessionLoadGeneration += 1
    for (const batcher of streamingBatchers.values()) batcher.flush()
    for (const batcher of toolArgsBatchers.values()) batcher.flush()
    streamingBatchers.clear()
    toolArgsBatchers.clear()
    runningSessions.clear()
    runIdsBySession.clear()
    runViews.clear()
    pendingDraftSends.clear()
    backgroundAttentionSessions.clear()
    finishingRuns.clear()
    lastCompletedRunIds.clear()
    set({ ...workspaceScopePatch(), runningSessionId: null, runningSessionIds: [], backgroundAttentionSessionId: null, backgroundAttentionSessionIds: [], liveSkillEvents: [], liveRuleEvents: [] })
  },

  send: async (text, reqBase) => {
    let initial = get()
    hydrateLegacyRunState(initial)
    if (hasActiveRun(initial.activeId, initial) || (!text.trim() && !initial.messageFiles.length && !initial.attachments.length)) return
    const generation = workspaceGeneration
    const platform = getPlatformApi()
    let sessionId = initial.activeId
    if (!sessionId) {
      try {
        const session = await platform.createSession()
        if (generation !== workspaceGeneration || getPlatformApi() !== platform) return
        preserveActiveRunView(get())
        sessionId = session.id
        backgroundAttentionSessions.delete(sessionId)
        set({ ...sessionScopePatch(session), ...emptyRunView(), ...runIndicatorPatch(sessionId) })
        await reloadSessions(set, generation)
        initial = get()
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
        return
      }
    }
    if (runningSessions.has(sessionId)) return

    const draftScope = currentDraftScope(sessionId)
    const draft = chatDraftStore.beginSend(draftScope, text)
    const transaction: PendingDraftSend = {
      ...draft,
      sessionId,
      beforeMessageIds: new Set(initial.activeId === sessionId ? initial.messages.map((message) => message.id) : []),
      confirmed: false
    }
    pendingDraftSends.set(sessionId, transaction)
    runningSessions.add(sessionId)
    runIdsBySession.delete(sessionId)
    backgroundAttentionSessions.delete(sessionId)
    const view = {
      ...emptyRunView(),
      lastAppliedChange: initial.activeId === sessionId ? initial.lastAppliedChange : null
    }
    runViews.set(sessionId, view)
    set({ ...view, ...runIndicatorPatch(get().activeId), contextCompression: null })
    const attachments = initial.activeId === sessionId ? initial.attachments : []
    const messageFiles = initial.activeId === sessionId ? initial.messageFiles : []
    const chapterTextCandidate = attachments.some((attachment) => isChapterTextCandidatePurpose(attachment.purpose))
    const requestedCreative = reqBase.creative ?? (initial.activeId === sessionId ? initial.creativePreferences : undefined)
    const req: RunAgentRequest = {
      sessionId,
      message: text.trim() || (messageFiles.length ? '请分析所附资料。' : ''),
      attachments: attachments.length ? attachments : undefined,
      files: messageFiles.length ? messageFiles : undefined,
      approvalPolicy: initial.activeId === sessionId ? initial.approvalPolicy : 'strict',
      ...reqBase,
      ...(chapterTextCandidate ? { mode: 'normal' as const } : {}),
      creative: chapterTextCandidate
        ? {
            ...DEFAULT_CREATIVE_PREFERENCES,
            selectedSkillIds: requestedCreative?.selectedSkillIds ?? [],
            selectedRuleSetIds: requestedCreative?.selectedRuleSetIds ?? []
          }
        : requestedCreative
    }
    try {
      const accepted = await platform.agentRun(req)
      // The done event can arrive before agentRun resolves. In that case the
      // run transaction has already been released and this late acceptance is
      // no longer allowed to resurrect it.
      if (pendingDraftSends.get(sessionId) !== transaction) return
      if (generation !== workspaceGeneration || getPlatformApi() !== platform) {
        runningSessions.delete(sessionId)
        runIdsBySession.delete(sessionId)
        runViews.delete(sessionId)
        pendingDraftSends.delete(sessionId)
        flushStreamingDelta(sessionId)
        flushToolArgsDelta(sessionId)
        releaseRunBatches(sessionId)
        return
      }
      if (accepted.sessionId !== sessionId) {
        runningSessions.delete(sessionId)
        runViews.delete(sessionId)
        pendingDraftSends.delete(sessionId)
        sessionId = accepted.sessionId
        runningSessions.add(sessionId)
        pendingDraftSends.set(sessionId, transaction)
        runViews.set(sessionId, view)
      }
      if (accepted.runId) runIdsBySession.set(sessionId, accepted.runId)
      if (!shouldKeepStreamingAfterAcceptance({ accepted: true, done: false })) runningSessions.delete(sessionId)
      set(runIndicatorPatch(get().activeId))
    } catch (err) {
      if (pendingDraftSends.get(sessionId) !== transaction) return
      if (!transaction.confirmed) chatDraftStore.restoreAfterFailure(transaction)
      runningSessions.delete(sessionId)
      runIdsBySession.delete(sessionId)
      runViews.delete(sessionId)
      pendingDraftSends.delete(sessionId)
      flushStreamingDelta(sessionId)
      flushToolArgsDelta(sessionId)
      releaseRunBatches(sessionId)
      const message = err instanceof Error ? err.message : String(err)
      if (get().activeId === sessionId) set({ ...emptyRunView(), error: message, ...runIndicatorPatch(sessionId) })
      else {
        backgroundAttentionSessions.add(sessionId)
        set(runIndicatorPatch(get().activeId))
      }
    }
  },

  confirmChange: async (approved) => {
    const change = get().pendingChange
    if (!change) return
    set({ pendingChange: null })
    const sessionId = get().activeId
    if (!sessionId) throw new Error('当前没有可确认的会话')
    await getPlatformApi().agentConfirm(sessionId, change.id, approved)
    saveRunView(sessionId, get())
  },

  answerQuestion: async (answer) => {
    const pending = get().pendingQuestion
    if (!pending || pending.questionId !== answer.questionId) throw new Error('当前没有等待回答的问题')
    const platform = getPlatformApi()
    if (!platform.agentAnswerQuestion) throw new Error('当前平台暂不支持回答智能体问题')
    try {
      await platform.agentAnswerQuestion(answer)
      if (get().pendingQuestion?.questionId === answer.questionId) {
        set({ pendingQuestion: null, waitingRunId: null, error: null })
        if (get().activeId) saveRunView(get().activeId!, get())
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  resolveSkillCandidate: async (candidateId, actionName) => {
    const pending = get().pendingSkillCandidate
    if (!pending || pending.candidateId !== candidateId) throw new Error('当前没有等待处理的 Skill 候选')
    const platform = getPlatformApi()
    if (!platform.agentResolveSkillCandidate) throw new Error('当前平台暂不支持处理 Skill 候选')
    try {
      await platform.agentResolveSkillCandidate(candidateId, actionName)
      if (get().pendingSkillCandidate?.candidateId === candidateId) {
        set({ pendingSkillCandidate: null, waitingRunId: null, error: null })
        if (get().activeId) saveRunView(get().activeId!, get())
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  compressContext: async () => {
    const sessionId = get().activeId
    if (!sessionId) throw new Error('请先创建或打开会话')
    if (hasActiveRun(sessionId, get()) || get().contextCompressing) return
    const settings = useSettings.getState().settings
    const preferred = settings?.defaultChatModel
    const provider = preferred && settings.providers.find((item) => item.id === preferred.providerId && item.models.includes(preferred.model) && item.hasKey)
    if (!preferred || !provider) {
      const error = new Error('请先配置可用的默认对话模型')
      set({ error: error.message })
      throw error
    }
    const generation = workspaceGeneration
    const platform = getPlatformApi()
    set({ contextCompressing: true, contextCompression: null, error: null })
    try {
      const session = await platform.compressSessionContext(sessionId, preferred.providerId, preferred.model)
      if (generation !== workspaceGeneration || getPlatformApi() !== platform || get().activeId !== sessionId) return
      applySession(set, session)
      set({ contextCompressing: false, error: null })
      await reloadSessions(set, generation)
    } catch (error) {
      if (generation !== workspaceGeneration || getPlatformApi() !== platform) return
      set({ contextCompressing: false, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  stopSession: async (id) => {
    await getPlatformApi().agentAbort(id)
  },

  abort: async () => {
    const state = get()
    hydrateLegacyRunState(state)
    const id = hasActiveRun(state.activeId, state)
      ? state.activeId
      : state.runningSessionId ?? state.runningSessionIds[0] ?? null
    if (id) {
      flushStreamingDelta(id)
      flushToolArgsDelta(id)
    }
    if (id) await get().stopSession(id)
  },

  bindEvents: () => {
    return getPlatformApi().onAgentEvent((envelope: AgentEventEnvelope) => handleEvent(envelope, set, get))
  }
}))

onSettingsUpdated(async (settings, patch) => {
  if (!patch.orchestrationDefaults) return
  const state = useChat.getState()
  if (!state.activeId || !state.creativePreferences?.orchestrationEnabled) return
  const next = syncOrchestrationBudget(state.creativePreferences, settings)
  const currentBudget = state.creativePreferences.orchestration
  const nextBudget = next?.orchestration
  if (!next || !nextBudget || !currentBudget || (currentBudget.maxCalls === nextBudget.maxCalls && currentBudget.maxEstimatedTokens === nextBudget.maxEstimatedTokens)) return
  try {
    await state.updateCreativePreferences(next)
  } catch (error) {
    useChat.setState({ error: error instanceof Error ? error.message : String(error) })
  }
})

function applySession(
  set: (p: Partial<ChatState>) => void,
  s: ChatSession
): void {
  set(sessionScopePatch(s))
}

/** Migrates an old session-owned budget to the current app default when it is opened. */
async function syncSessionOrchestrationBudget(session: ChatSession): Promise<ChatSession> {
  const settings = useSettings.getState().settings
  if (!settings || !session.creativePreferences?.orchestrationEnabled) return session
  const next = syncOrchestrationBudget(session.creativePreferences, settings)
  const currentBudget = session.creativePreferences.orchestration
  const nextBudget = next?.orchestration
  if (!next || !nextBudget || !currentBudget || (currentBudget.maxCalls === nextBudget.maxCalls && currentBudget.maxEstimatedTokens === nextBudget.maxEstimatedTokens)) return session
  await getPlatformApi().updateSession(session.id, { creativePreferences: next })
  return { ...session, creativePreferences: next }
}

const APPLIED_WORKSPACE_REFRESH_DEBOUNCE_MS = 50
let appliedWorkspaceRefreshRequested = false
let appliedWorkspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null
let appliedWorkspaceRefreshPromise: Promise<void> | null = null

function reportWorkspaceRefreshError(set: SetFn, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  set((state) => state.error ? {} : { error: message })
}

function beginAppliedWorkspaceRefresh(set: SetFn): Promise<void> {
  if (appliedWorkspaceRefreshPromise) return appliedWorkspaceRefreshPromise
  if (!appliedWorkspaceRefreshRequested) return Promise.resolve()
  appliedWorkspaceRefreshPromise = (async () => {
    do {
      appliedWorkspaceRefreshRequested = false
      try {
        await useWorkspace.getState().refresh()
      } catch (error) {
        reportWorkspaceRefreshError(set, error)
      }
    } while (appliedWorkspaceRefreshRequested)
  })().finally(() => { appliedWorkspaceRefreshPromise = null })
  return appliedWorkspaceRefreshPromise
}

function requestAppliedWorkspaceRefresh(set: SetFn): void {
  appliedWorkspaceRefreshRequested = true
  if (appliedWorkspaceRefreshPromise || appliedWorkspaceRefreshTimer) return
  appliedWorkspaceRefreshTimer = setTimeout(() => {
    appliedWorkspaceRefreshTimer = null
    void beginAppliedWorkspaceRefresh(set)
  }, APPLIED_WORKSPACE_REFRESH_DEBOUNCE_MS)
}

async function flushAppliedWorkspaceRefresh(set: SetFn): Promise<void> {
  if (appliedWorkspaceRefreshTimer) {
    clearTimeout(appliedWorkspaceRefreshTimer)
    appliedWorkspaceRefreshTimer = null
  }
  await beginAppliedWorkspaceRefresh(set)
}

/**
 * 流式文本按帧合并：token 可能比帧率快得多，逐条 set 会让整段 Markdown 反复重解析。
 * set 在 zustand store 内是稳定引用，因此延迟创建一次即可。
 */
const streamingBatchers = new Map<string, ReturnType<typeof createRafBatcher<{ messageId: string; delta: string }>>>()
const MAX_LIVE_TOOL_ARGS = 12000
const toolArgsBatchers = new Map<string, ReturnType<typeof createRafBatcher<{ callId: string; delta: string }>>>()

function clipLiveToolArgs(value: string): string {
  if (value.length <= MAX_LIVE_TOOL_ARGS) return value
  return `${value.slice(0, MAX_LIVE_TOOL_ARGS - 24)}\n…工具参数过长，已省略…`
}

function appendLiveToolArgs(current: string, delta: string): string {
  if (current.length >= MAX_LIVE_TOOL_ARGS) return current
  return clipLiveToolArgs(`${current}${delta}`)
}

function pushStreamingDelta(set: SetFn, sessionId: string, messageId: string, delta: string): void {
  let batcher = streamingBatchers.get(sessionId)
  if (!batcher) {
    batcher = createRafBatcher<{ messageId: string; delta: string }>((chunks) => {
      const current = useChat.getState()
      if (current.activeId !== sessionId) {
        const stored = runViews.get(sessionId) ?? emptyRunView()
        const timeline = [...stored.liveTimeline]
        let streamingText = stored.streamingText ?? ''
        for (const chunk of chunks) {
          const next = appendTextDelta(timeline, chunk.messageId, chunk.delta)
          timeline.splice(0, timeline.length, ...next)
          if (!chunk.messageId.includes('_child_') && !chunk.messageId.includes('_stage_')) streamingText += chunk.delta
        }
        runViews.set(sessionId, { ...stored, streamingText, liveTimeline: timeline })
        return
      }
      set((p) => {
      const timeline = [...p.liveTimeline]
      let streamingText = p.streamingText ?? ''
      for (const chunk of chunks) {
        const next = appendTextDelta(timeline, chunk.messageId, chunk.delta)
        timeline.splice(0, timeline.length, ...next)
        // Keep the legacy aggregate for the primary reply only. Child and
        // stage messages have their own stable rows and must not be merged into it.
        if (!chunk.messageId.includes('_child_') && !chunk.messageId.includes('_stage_')) streamingText += chunk.delta
      }
      return { streamingText, liveTimeline: timeline }
      })
    })
    streamingBatchers.set(sessionId, batcher)
  }
  batcher.push({ messageId, delta })
}

function flushStreamingDelta(sessionId: string): void {
  streamingBatchers.get(sessionId)?.flush()
}

function pushToolArgsDelta(set: SetFn, sessionId: string, callId: string, delta: string): void {
  let batcher = toolArgsBatchers.get(sessionId)
  if (!batcher) {
    batcher = createRafBatcher<{ callId: string; delta: string }>((chunks) => {
      const grouped = new Map<string, string>()
      for (const chunk of chunks) grouped.set(chunk.callId, `${grouped.get(chunk.callId) ?? ''}${chunk.delta}`)
      const current = useChat.getState()
      if (current.activeId !== sessionId) {
        const stored = runViews.get(sessionId) ?? emptyRunView()
        let timeline = stored.liveTimeline
        let liveTools = stored.liveTools
        for (const [id, value] of grouped) {
          timeline = timeline.map((item) => item.kind === 'tool' && item.callId === id ? { ...item, argsJson: appendLiveToolArgs(item.argsJson, value) } : item)
          liveTools = liveTools.map((item) => item.callId === id ? { ...item, argsJson: appendLiveToolArgs(item.argsJson, value) } : item)
        }
        runViews.set(sessionId, { ...stored, liveTimeline: timeline, liveTools })
        return
      }
      set((p) => {
        let timeline = p.liveTimeline
        let liveTools = p.liveTools
        for (const [id, value] of grouped) {
          timeline = timeline.map((item) => item.kind === 'tool' && item.callId === id ? { ...item, argsJson: appendLiveToolArgs(item.argsJson, value) } : item)
          liveTools = liveTools.map((item) => item.callId === id ? { ...item, argsJson: appendLiveToolArgs(item.argsJson, value) } : item)
        }
        return { liveTimeline: timeline, liveTools }
      })
    })
    toolArgsBatchers.set(sessionId, batcher)
  }
  batcher.push({ callId, delta })
}

function flushToolArgsDelta(sessionId: string): void {
  toolArgsBatchers.get(sessionId)?.flush()
}

function releaseRunBatches(sessionId: string): void {
  streamingBatchers.delete(sessionId)
  toolArgsBatchers.delete(sessionId)
}

function handleEvent(envelope: AgentEventEnvelope, set: SetFn, get: () => ChatState): void {
  hydrateLegacyRunState(get())
  const actualState = get()
  const isBackgroundEvent = envelope.sessionId !== actualState.activeId
  if (isBackgroundEvent && (envelope.event.type === 'pending-change' || envelope.event.type === 'agent-question' || envelope.event.type === 'skill-candidate' || envelope.event.type === 'waiting-user' || envelope.event.type === 'error')) {
    backgroundAttentionSessions.add(envelope.sessionId)
    set(runIndicatorPatch(actualState.activeId))
  }
  if (envelope.sessionId !== actualState.activeId && runningSessions.has(envelope.sessionId)) {
    const sessionId = envelope.sessionId
    const initialView = runViews.get(sessionId) ?? emptyRunView()
    let scopedState: ChatState = {
      ...actualState,
      ...initialView,
      activeId: sessionId,
      streaming: true,
      runningSessionId: sessionId,
      runningSessionIds: [...runningSessions],
      backgroundAttentionSessionIds: [...backgroundAttentionSessions],
      backgroundAttentionSessionId: actualState.backgroundAttentionSessionId
    }
    const scopedSet: SetFn = (partial) => {
      const patch = typeof partial === 'function' ? partial(scopedState) : partial
      scopedState = { ...scopedState, ...patch }
      saveRunView(sessionId, scopedState)
      if ('sessions' in patch) set({ sessions: patch.sessions })
      if (patch.error) backgroundAttentionSessions.add(sessionId)
      set(runIndicatorPatch(actualState.activeId))
    }
    const scopedGet = (): ChatState => scopedState
    handleEvent(envelope, scopedSet, scopedGet)
    saveRunView(sessionId, scopedState)
    return
  }

  const ev = envelope.event
  const expectedRunId = runIdsBySession.get(envelope.sessionId)
  if (envelope.runId && lastCompletedRunIds.get(envelope.sessionId) === envelope.runId) return
  if (envelope.runId && expectedRunId && envelope.runId !== expectedRunId) return
  if (envelope.runId && !expectedRunId && runningSessions.has(envelope.sessionId)) runIdsBySession.set(envelope.sessionId, envelope.runId)
  if ((ev.type === 'change-result' && ev.status === 'applied') || (ev.type === 'change-applied' && ev.approved)) requestAppliedWorkspaceRefresh(set)

  // A session snapshot confirms the outgoing draft even if the user has opened
  // another conversation before the agent accepted the request.
  if (ev.type === 'session') {
    const transaction = pendingDraftSends.get(envelope.sessionId)
    if (transaction && !transaction.confirmed && transaction.scope.workspaceKey === currentDraftScope(envelope.sessionId).workspaceKey && (!transaction.sessionId || transaction.sessionId === envelope.sessionId)) {
      const hasNewUserMessage = ev.session.messages.some((message) => message.role === 'user' && !transaction.beforeMessageIds.has(message.id))
      if (hasNewUserMessage) {
        chatDraftStore.clearAfterAccepted(transaction)
        transaction.confirmed = true
        transaction.sessionId = envelope.sessionId
      }
    }
  }

  const isRunningSession = runningSessions.has(envelope.sessionId)
  if (ev.type === 'done' && isRunningSession) {
    const runKey = `${envelope.sessionId}:${envelope.runId ?? ''}`
    if (finishingRuns.has(runKey)) return
    finishingRuns.add(runKey)
    flushStreamingDelta(envelope.sessionId)
    flushToolArgsDelta(envelope.sessionId)
    const enabled = useSettings.getState().settings?.completionSound ?? false
    if (shouldPlayCompletionSound({ enabled, error: get().error !== null })) playCompletionSound()
    void finishRun(envelope.sessionId, ev.session, set, get, envelope.runId)
    return
  }

  // Only the viewed session may update visible messages and live activity.
  if (envelope.sessionId !== get().activeId) return
  if (ev.type !== 'tool-args-delta') flushToolArgsDelta(envelope.sessionId)
  switch (ev.type) {
    case 'session': {
      const patch = sessionEventPatch(get().activeId, envelope)
      if (patch) set({ ...patch, attachments: [], messageFiles: [] })
      break
    }
    case 'text-delta':
      pushStreamingDelta(set, envelope.sessionId, ev.messageId, ev.delta)
      break
    case 'stage-start':
      flushStreamingDelta(envelope.sessionId)
      set((p) => ({ liveTimeline: [...p.liveTimeline.filter((item) => item.kind !== 'stage' || item.stageId !== ev.stageId), { kind: 'stage', id: `stage_${ev.stageId}`, stageId: ev.stageId, status: 'running' }] }))
      break
    case 'stage-complete':
      set((p) => ({ liveTimeline: p.liveTimeline.map((item) => item.kind === 'stage' && item.stageId === ev.stageId ? { ...item, status: 'completed' as const } : item) }))
      break
    case 'skill-activity':
      set((p) => ({ liveSkillEvents: [...p.liveSkillEvents, ev.activity].slice(-80) }))
      break
    case 'rule-activity':
      set((p) => ({ liveRuleEvents: [...p.liveRuleEvents, ev.activity].slice(-80) }))
      break
    case 'goal-task':
      flushStreamingDelta(envelope.sessionId)
      set((p) => ({
        liveTimeline: [...p.liveTimeline.filter((item) => item.kind !== 'stage' || item.id !== `goal_${ev.task.id}`), {
          kind: 'stage', id: `goal_${ev.task.id}`, stageId: `目标：${ev.task.title}`,
          status: ev.task.status === 'completed' ? 'completed' as const : ev.task.status === 'failed' ? 'failed' as const : 'running' as const
        }]
      }))
      break
    case 'goal-validation':
      set((p) => ({ liveTimeline: p.liveTimeline.map((item) => item.kind === 'stage' && item.id === `goal_${ev.taskId}` ? { ...item, status: ev.passed ? 'completed' as const : 'failed' as const } : item) }))
      break
    case 'goal-plan':
    case 'approval-policy':
      break
    case 'tool-start':
      flushStreamingDelta(envelope.sessionId)
      set((p) => ({
        liveTimeline: p.liveTimeline.some((item) => item.kind === 'tool' && item.callId === ev.callId)
          ? p.liveTimeline.map((item) => item.kind === 'tool' && item.callId === ev.callId ? { ...item, name: ev.name, argsJson: ev.argsJson ? clipLiveToolArgs(ev.argsJson) : item.argsJson } : item)
          : [...p.liveTimeline, { kind: 'tool', callId: ev.callId, name: ev.name, argsJson: clipLiveToolArgs(ev.argsJson), status: 'running' }],
        liveTools: p.liveTools.some((item) => item.callId === ev.callId)
          ? p.liveTools.map((item) => item.callId === ev.callId ? { ...item, name: ev.name, argsJson: ev.argsJson ? clipLiveToolArgs(ev.argsJson) : item.argsJson } : item)
          : [...p.liveTools, { callId: ev.callId, name: ev.name, argsJson: clipLiveToolArgs(ev.argsJson), status: 'running' }]
      }))
      break
    case 'tool-args-delta':
      pushToolArgsDelta(set, envelope.sessionId, ev.callId, ev.delta)
      break
    case 'tool-preview':
      set((p) => ({
        liveTimeline: p.liveTimeline.map((item) => item.kind === 'tool' && item.callId === ev.callId ? { ...item, preview: clipLiveToolArgs(ev.preview) } : item),
        liveTools: p.liveTools.map((item) => item.callId === ev.callId ? { ...item, preview: clipLiveToolArgs(ev.preview) } : item)
      }))
      break
    case 'budget':
      set({ budget: ev.snapshot })
      break
    case 'tool-done':
      set((p) => ({
        liveTimeline: p.liveTimeline.map((item) =>
          item.kind === 'tool' && item.callId === ev.callId
            ? { ...item, status: ev.ok ? ('ok' as const) : ('error' as const), preview: ev.resultPreview }
            : item
        ),
        liveTools: p.liveTools.map((t) =>
          t.callId === ev.callId ? { ...t, status: ev.ok ? ('ok' as const) : ('error' as const), preview: ev.resultPreview } : t
        )
      }))
      break
    case 'pending-change':
      set((p) => {
        const lastToolIndex = p.liveTimeline.findLastIndex((item) => item.kind === 'tool')
        return {
          pendingChange: ev.change,
          lastPendingChange: ev.change,
          liveTimeline: lastToolIndex < 0
            ? p.liveTimeline
            : p.liveTimeline.map((item, index) =>
                index === lastToolIndex && item.kind === 'tool'
                  ? { ...item, status: 'pending' as const, preview: '等待你确认写回' }
                  : item
              )
        }
      })
      break
    case 'agent-question':
      flushStreamingDelta(envelope.sessionId)
      if (ev.question.sessionId !== envelope.sessionId || (envelope.runId && ev.question.runId !== envelope.runId)) break
      set({ pendingQuestion: ev.question, pendingSkillCandidate: null, waitingRunId: envelope.runId ?? ev.question.runId, contextCompressing: false })
      break
    case 'skill-candidate':
      flushStreamingDelta(envelope.sessionId)
      if (ev.candidate.sessionId !== envelope.sessionId || (envelope.runId && ev.candidate.runId !== envelope.runId)) break
      set({ pendingSkillCandidate: ev.candidate, pendingQuestion: null, waitingRunId: envelope.runId ?? ev.candidate.runId, contextCompressing: false })
      break
    case 'waiting-user':
      break
    case 'change-applied':
      if (get().pendingChange?.id === ev.changeId) set({ pendingChange: null })
      if (ev.approved && get().lastPendingChange?.id === ev.changeId) {
        set({ lastAppliedChange: get().lastPendingChange })
      }
      break
    case 'change-result':
      if (get().pendingChange?.id === ev.changeId) set({ pendingChange: null })
      if (ev.status === 'applied') {
        const legacyChange = get().lastPendingChange?.id === ev.changeId ? get().lastPendingChange : null
        const appliedChange = ev.appliedChange ?? legacyChange
        set({ ...(appliedChange ? { lastAppliedChange: appliedChange } : {}), error: null })
      } else if (ev.status === 'conflict' || ev.status === 'failed') {
        set({ error: ev.message })
      }
      break
    case 'context-compression-start':
      set({ contextCompressing: true })
      break
    case 'context-compressed':
      set({
        contextCompressing: false,
        ...(ev.summary !== undefined ? { contextSummary: ev.summary } : {}),
        contextSummaryThrough: ev.throughMessageId,
        contextSummaryUpdatedAt: ev.summaryUpdatedAt,
        contextCompression: {
          beforeTokens: ev.beforeTokens,
          afterTokens: ev.afterTokens,
          summarizedMessages: ev.summarizedMessages,
          at: ev.summaryUpdatedAt
        }
      })
      break
    case 'run-paused':
      flushStreamingDelta(envelope.sessionId)
      set({ error: ev.message, streaming: false, contextCompressing: false, liveTools: [] })
      break
    case 'error':
      flushStreamingDelta(envelope.sessionId)
      set((state) => ({
        error: ev.message,
        streaming: false,
        contextCompressing: false,
        liveTools: [],
        liveTimeline: ev.stageId
          ? state.liveTimeline.map((item) => item.kind === 'stage' && item.stageId === ev.stageId ? { ...item, status: 'failed' as const } : item)
          : state.liveTimeline
      }))
      break
    case 'done':
      break
  }
  if (runningSessions.has(envelope.sessionId)) saveRunView(envelope.sessionId, get())
  set(runIndicatorPatch(get().activeId))
}

async function finishRun(
  sessionId: string,
  completedSession: ChatSession | undefined,
  set: SetFn,
  get: () => ChatState,
  runId?: string
): Promise<void> {
  let applied = false
  try {
    await flushAppliedWorkspaceRefresh(set)
    const session = completedSession ?? await getPlatformApi().loadSession(sessionId)
    if (session && (!get().activeId || get().activeId === sessionId) && hasAssistantAfterLatestUser(session)) {
      applySession(set, session)
      applied = true
    }
    await reloadSessions(set)
  } catch (err) {
    if (get().activeId === sessionId) set({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    const current = get()
    const finalView = applied
      ? { ...emptyRunView(), lastPendingChange: current.lastPendingChange, lastAppliedChange: current.lastAppliedChange }
      : current.activeId === sessionId
        ? {
            streamingText: current.streamingText,
            liveTimeline: current.liveTimeline,
            liveTools: current.liveTools,
            liveSkillEvents: current.liveSkillEvents,
            liveRuleEvents: current.liveRuleEvents,
            contextCompressing: false,
            contextCompression: current.contextCompression,
            pendingQuestion: null,
            pendingSkillCandidate: null,
            waitingRunId: null,
            pendingChange: current.pendingChange,
            lastPendingChange: current.lastPendingChange,
            lastAppliedChange: current.lastAppliedChange,
            error: current.error
          }
        : emptyRunView()
    runningSessions.delete(sessionId)
    runIdsBySession.delete(sessionId)
    pendingDraftSends.delete(sessionId)
    runViews.delete(sessionId)
    backgroundAttentionSessions.delete(sessionId)
    if (runId) lastCompletedRunIds.set(sessionId, runId)
    finishingRuns.delete(`${sessionId}:${runId ?? ''}`)
    releaseRunBatches(sessionId)
    set({ ...finalView, ...runIndicatorPatch(get().activeId) })
  }
}

export function toolArgsPreview(argsJson: string, max = 60): string {
  try {
    const obj = JSON.parse(argsJson || '{}') as Record<string, unknown>
    const parts = Object.entries(obj).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    const s = parts.join('，')
    return s.length > max ? s.slice(0, max) + '…' : s
  } catch {
    return argsJson.slice(0, max)
  }
}

export type { ToolCallData }
