import { create } from 'zustand'
import type { AgentEventEnvelope } from '../../../shared/api'
import type {
  Attachment,
  ChatMessage,
  ChatSession,
  AgentBudgetSnapshot,
  MessageFile,
  PendingChange,
  RunAgentRequest,
  SessionMeta,
  SessionModelPreference
} from '../../../shared/types'
import type { CreativePreferences } from '../../../shared/creative'
import { useWorkspace } from './workspaceStore'
import type { ToolCallData } from '../../../shared/types'
import { getPlatformApi } from '../platform/platformApi'
import { hasAssistantAfterLatestUser, sessionEventPatch } from './chatEvents'
import { playCompletionSound, shouldPlayCompletionSound } from '../lib/completionSound'
import { createRafBatcher } from '../lib/rafBatcher'
import { useSettings } from './settingsStore'
import { sessionScopePatch, shouldKeepStreamingAfterAcceptance, workspaceScopePatch } from './chatScope'
import { chatDraftScope, chatDraftStore, type DraftSendTransaction } from './chatDraftStore'
import { getPlatformUiSource } from '../platform/platformApi'

/** 流式期间的临时工具调用展示项 */
export interface LiveToolRun {
  callId: string
  name: string
  argsJson: string
  status: 'running' | 'pending' | 'ok' | 'error'
  preview?: string
}

export type LiveTurnItem =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; callId: string; name: string; argsJson: string; status: LiveToolRun['status']; preview?: string }
  | { kind: 'stage'; id: string; stageId: string; status: 'running' | 'completed' | 'failed' }

interface ChatState {
  sessions: SessionMeta[]
  activeId: string | null
  messages: ChatMessage[]
  modelPreferences: SessionModelPreference[]
  orchestrationRuns: import('../../../shared/types').OrchestrationRunRecord[]
  budget: AgentBudgetSnapshot | null
  /** 正在流式生成的助手草稿 */
  streamingText: string
  streaming: boolean
  liveTimeline: LiveTurnItem[]
  liveTools: LiveToolRun[]
  contextSummary?: string
  contextSummaryThrough?: string
  contextSummaryUpdatedAt?: number
  contextCompressing: boolean
  contextCompression: { beforeTokens: number; afterTokens: number; summarizedMessages: number; at: number } | null
  pendingChange: PendingChange | null
  /** 最近一次推送给用户确认的变更（change-applied 时据此识别） */
  lastPendingChange: PendingChange | null
  /** 最近一次被用户确认写入的变更（供编辑页联动重载） */
  lastAppliedChange: PendingChange | null
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
  resetWorkspace: () => void

  send: (text: string, req: Omit<RunAgentRequest, 'message' | 'sessionId' | 'attachments'> & { creative?: CreativePreferences }) => Promise<void>
  confirmChange: (approved: boolean) => Promise<void>
  abort: () => Promise<void>

  /** 全局事件订阅（App 挂载时调用一次） */
  bindEvents: () => () => void
}

type SetFn = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void

let runningSessionId: string | null = null
let finishingSessionId: string | null = null
let completedSessionId: string | null = null
let runningRunId: string | null = null
let pendingDraftSend: (DraftSendTransaction & { sessionId: string | null; beforeMessageIds: Set<string>; confirmed: boolean }) | null = null
let workspaceGeneration = 0
let sessionLoadGeneration = 0

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
  modelPreferences: [],
  orchestrationRuns: [],
  budget: null,
  streamingText: '',
  streaming: false,
  liveTimeline: [],
  liveTools: [],
  contextCompressing: false,
  contextCompression: null,
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
    if (get().streaming) return
    const generation = workspaceGeneration
    const request = ++sessionLoadGeneration
    const platform = getPlatformApi()
    const s = await platform.loadSession(id)
    if (generation !== workspaceGeneration || request !== sessionLoadGeneration || getPlatformApi() !== platform) return
    if (!s) return
    applySession(set, s)
    set({ contextCompression: null })
  },

  newSession: async () => {
    if (get().streaming) return
    const generation = workspaceGeneration
    ++sessionLoadGeneration
    const platform = getPlatformApi()
    try {
      const session = await platform.createSession()
      if (generation !== workspaceGeneration || getPlatformApi() !== platform) return
      set({ ...sessionScopePatch(session), contextCompression: null, error: null })
      await reloadSessions(set, generation)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  removeSession: async (id) => {
    const generation = workspaceGeneration
    const platform = getPlatformApi()
    await platform.deleteSession(id)
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

  resetWorkspace: () => {
    workspaceGeneration += 1
    sessionLoadGeneration += 1
    runningSessionId = null
    finishingSessionId = null
    completedSessionId = null
    runningRunId = null
    pendingDraftSend = null
    set(workspaceScopePatch())
  },

  send: async (text, reqBase) => {
    if (get().streaming || (!text.trim() && !get().messageFiles.length && !get().attachments.length)) return
    const draftScope = currentDraftScope(get().activeId)
    const draft = chatDraftStore.beginSend(draftScope, text)
    pendingDraftSend = {
      ...draft,
      sessionId: get().activeId,
      beforeMessageIds: new Set(get().messages.map((message) => message.id)),
      confirmed: false
    }
    set({ streaming: true, streamingText: '', liveTimeline: [], liveTools: [], contextCompressing: false, contextCompression: null, error: null })
    completedSessionId = null
    runningRunId = null
    const req: RunAgentRequest = {
      sessionId: get().activeId ?? undefined,
      message: text.trim() || (get().messageFiles.length ? '请分析所附资料。' : ''),
      attachments: get().attachments.length ? get().attachments : undefined,
      files: get().messageFiles.length ? get().messageFiles : undefined,
      ...reqBase
    }
    runningSessionId = req.sessionId ?? null
    try {
      const { sessionId, runId } = await getPlatformApi().agentRun(req)
      runningSessionId = sessionId
      if (runId) runningRunId = runId
      if (!get().activeId) set({ activeId: sessionId })
      if (!shouldKeepStreamingAfterAcceptance({ accepted: true, done: false })) {
        runningSessionId = null
        set({ streaming: false })
      }
    } catch (err) {
      const transaction = pendingDraftSend
      if (transaction && !transaction.confirmed) chatDraftStore.restoreAfterFailure(transaction)
      set({ error: err instanceof Error ? err.message : String(err) })
      flushStreamingDelta()
      set({ streaming: false, streamingText: '', liveTimeline: [], liveTools: [], contextCompressing: false })
      runningSessionId = null
      pendingDraftSend = null
    }
  },

  confirmChange: async (approved) => {
    const change = get().pendingChange
    if (!change) return
    set({ pendingChange: null })
    await getPlatformApi().agentConfirm(change.id, approved)
    if (approved) await useWorkspaceRefresh()
  },

  abort: async () => {
    flushStreamingDelta()
    const id = get().activeId ?? runningSessionId
    if (id) await getPlatformApi().agentAbort(id)
  },

  bindEvents: () => {
    return getPlatformApi().onAgentEvent((envelope: AgentEventEnvelope) => handleEvent(envelope, set, get))
  }
}))

function applySession(
  set: (p: Partial<ChatState>) => void,
  s: ChatSession
): void {
  set(sessionScopePatch(s))
}

function useWorkspaceRefresh(): Promise<void> {
  return useWorkspace.getState().refresh()
}

/**
 * 流式文本按帧合并：token 可能比帧率快得多，逐条 set 会让整段 Markdown 反复重解析。
 * set 在 zustand store 内是稳定引用，因此延迟创建一次即可。
 */
let streamingBatcher: ReturnType<typeof createRafBatcher<{ messageId: string; delta: string }>> | null = null

function pushStreamingDelta(set: SetFn, messageId: string, delta: string): void {
  if (!streamingBatcher) {
    streamingBatcher = createRafBatcher<{ messageId: string; delta: string }>((chunks) => set((p) => {
      const timeline = [...p.liveTimeline]
      let streamingText = p.streamingText ?? ''
      for (const chunk of chunks) {
        const id = `live_${chunk.messageId}`
        const last = timeline.at(-1)
        if (last?.kind === 'text' && last.id === id) {
          timeline[timeline.length - 1] = { ...last, text: last.text + chunk.delta }
        } else {
          timeline.push({ kind: 'text', id, text: chunk.delta })
        }
        streamingText += chunk.delta
      }
      return { streamingText, liveTimeline: timeline }
    }))
  }
  streamingBatcher.push({ messageId, delta })
}

function flushStreamingDelta(): void {
  streamingBatcher?.flush()
}

function handleEvent(envelope: AgentEventEnvelope, set: SetFn, get: () => ChatState): void {
  if (envelope.runId && runningRunId && envelope.runId !== runningRunId) return
  if (envelope.runId && !runningRunId && get().streaming) runningRunId = envelope.runId
  // 仅处理当前激活会话的事件；后台会话的结果在 send() 完成时统一落库
  if (envelope.sessionId !== get().activeId && !(get().streaming && !get().activeId)) {
    if (envelope.event.type !== 'done' && envelope.sessionId === runningSessionId && !get().activeId) {
      set({ activeId: envelope.sessionId })
    } else {
      return
    }
  }
  const ev = envelope.event
  switch (ev.type) {
    case 'session': {
      const transaction = pendingDraftSend
      if (transaction && !transaction.confirmed && transaction.scope.workspaceKey === currentDraftScope(get().activeId).workspaceKey && (!transaction.sessionId || transaction.sessionId === envelope.sessionId)) {
        const hasNewUserMessage = ev.session.messages.some((message) => message.role === 'user' && !transaction.beforeMessageIds.has(message.id))
        if (hasNewUserMessage) {
          chatDraftStore.clearAfterAccepted(transaction)
          transaction.confirmed = true
          transaction.sessionId = envelope.sessionId
        }
      }
      const patch = sessionEventPatch(get().activeId, envelope)
      if (patch) set({ ...patch, attachments: [], messageFiles: [] })
      break
    }
    case 'text-delta':
      pushStreamingDelta(set, ev.messageId, ev.delta)
      break
    case 'stage-start':
      flushStreamingDelta()
      set((p) => ({ liveTimeline: [...p.liveTimeline.filter((item) => item.kind !== 'stage' || item.stageId !== ev.stageId), { kind: 'stage', id: `stage_${ev.stageId}`, stageId: ev.stageId, status: 'running' }] }))
      break
    case 'stage-complete':
      set((p) => ({ liveTimeline: p.liveTimeline.map((item) => item.kind === 'stage' && item.stageId === ev.stageId ? { ...item, status: 'completed' as const } : item) }))
      break
    case 'tool-start':
      flushStreamingDelta()
      set((p) => ({
        liveTimeline: p.liveTimeline.some((item) => item.kind === 'tool' && item.callId === ev.callId)
          ? p.liveTimeline.map((item) => item.kind === 'tool' && item.callId === ev.callId ? { ...item, name: ev.name, argsJson: ev.argsJson || item.argsJson } : item)
          : [...p.liveTimeline, { kind: 'tool', callId: ev.callId, name: ev.name, argsJson: ev.argsJson, status: 'running' }],
        liveTools: p.liveTools.some((item) => item.callId === ev.callId)
          ? p.liveTools.map((item) => item.callId === ev.callId ? { ...item, name: ev.name, argsJson: ev.argsJson || item.argsJson } : item)
          : [...p.liveTools, { callId: ev.callId, name: ev.name, argsJson: ev.argsJson, status: 'running' }]
      }))
      break
    case 'tool-args-delta':
      set((p) => ({
        liveTimeline: p.liveTimeline.map((item) => item.kind === 'tool' && item.callId === ev.callId ? { ...item, argsJson: `${item.argsJson}${ev.delta}` } : item),
        liveTools: p.liveTools.map((item) => item.callId === ev.callId ? { ...item, argsJson: `${item.argsJson}${ev.delta}` } : item)
      }))
      break
    case 'tool-preview':
      set((p) => ({
        liveTimeline: p.liveTimeline.map((item) => item.kind === 'tool' && item.callId === ev.callId ? { ...item, preview: ev.preview } : item),
        liveTools: p.liveTools.map((item) => item.callId === ev.callId ? { ...item, preview: ev.preview } : item)
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
    case 'change-applied':
      if (get().pendingChange?.id === ev.changeId) set({ pendingChange: null })
      if (ev.approved && get().lastPendingChange?.id === ev.changeId) {
        set({ lastAppliedChange: get().lastPendingChange })
      }
      break
    case 'change-result':
      if (get().pendingChange?.id === ev.changeId) set({ pendingChange: null })
      if (ev.status === 'applied' && get().lastPendingChange?.id === ev.changeId) {
        set({ lastAppliedChange: get().lastPendingChange, error: null })
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
    case 'error':
      flushStreamingDelta()
      set({ error: ev.message, contextCompressing: false })
      break
    case 'done': {
      if (finishingSessionId === envelope.sessionId || completedSessionId === envelope.sessionId) break
      finishingSessionId = envelope.sessionId
      flushStreamingDelta()
      const enabled = useSettings.getState().settings?.completionSound ?? false
      if (shouldPlayCompletionSound({ enabled, error: get().error !== null })) playCompletionSound()
      void finishRun(envelope.sessionId, ev.session, set, get)
      break
    }
  }
}

async function finishRun(
  sessionId: string,
  completedSession: ChatSession | undefined,
  set: SetFn,
  get: () => ChatState
): Promise<void> {
  let applied = false
  try {
    const session = completedSession ?? await getPlatformApi().loadSession(sessionId)
    if (session && (!get().activeId || get().activeId === sessionId) && hasAssistantAfterLatestUser(session)) {
      applySession(set, session)
      applied = true
    }
    await reloadSessions(set)
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    if (runningSessionId === sessionId || get().activeId === sessionId) runningSessionId = null
    if (runningRunId && (!get().activeId || get().activeId === sessionId)) runningRunId = null
    if (get().activeId === sessionId || get().streaming) {
      set(applied
        ? { streaming: false, streamingText: '', liveTimeline: [], liveTools: [], contextCompressing: false }
        : { streaming: false, liveTimeline: [], liveTools: [], contextCompressing: false })
    }
    completedSessionId = sessionId
    finishingSessionId = null
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
