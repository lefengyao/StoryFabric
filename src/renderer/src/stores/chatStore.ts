import { create } from 'zustand'
import type { AgentEventEnvelope } from '../../../shared/api'
import type {
  Attachment,
  ChatMessage,
  ChatSession,
  MessageFile,
  PendingChange,
  RunAgentRequest,
  SessionMeta,
  SessionModelPreference
} from '../../../shared/types'
import { useWorkspace } from './workspaceStore'
import type { ToolCallData } from '../../../shared/types'
import { getPlatformApi } from '../platform/platformApi'
import { hasAssistantAfterLatestUser, sessionEventPatch } from './chatEvents'
import { playCompletionSound, shouldPlayCompletionSound } from '../lib/completionSound'
import { createRafBatcher } from '../lib/rafBatcher'
import { useSettings } from './settingsStore'
import { sessionScopePatch, shouldKeepStreamingAfterAcceptance, workspaceScopePatch } from './chatScope'

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

interface ChatState {
  sessions: SessionMeta[]
  activeId: string | null
  messages: ChatMessage[]
  modelPreferences: SessionModelPreference[]
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

  send: (text: string, req: Omit<RunAgentRequest, 'message' | 'sessionId' | 'attachments'>) => Promise<void>
  confirmChange: (approved: boolean) => Promise<void>
  abort: () => Promise<void>

  /** 全局事件订阅（App 挂载时调用一次） */
  bindEvents: () => () => void
}

type SetFn = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void

let runningSessionId: string | null = null
let finishingSessionId: string | null = null
let completedSessionId: string | null = null

async function reloadSessions(set: (p: Partial<ChatState>) => void): Promise<SessionMeta[]> {
  try {
    const sessions = await getPlatformApi().listSessions()
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
    await reloadSessions(set)
    const first = get().sessions[0]
    if (first && !get().activeId) await get().openSession(first.id)
  },

  openSession: async (id) => {
    if (get().streaming) return
    const s = await getPlatformApi().loadSession(id)
    if (!s) return
    applySession(set, s)
    set({ contextCompression: null })
  },

  newSession: async () => {
    if (get().streaming) return
    try {
      const session = await getPlatformApi().createSession()
      set({ ...sessionScopePatch(session), contextCompression: null, error: null })
      await reloadSessions(set)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  removeSession: async (id) => {
    await getPlatformApi().deleteSession(id)
    await reloadSessions(set)
    if (get().activeId === id) get().newSession()
  },

  renameSession: async (id, title) => {
    const t = title.trim()
    if (!t) return
    await getPlatformApi().updateSession(id, { title: t })
    await reloadSessions(set)
  },

  setArchived: async (id, archived) => {
    await getPlatformApi().updateSession(id, { archived })
    await reloadSessions(set)
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
    runningSessionId = null
    finishingSessionId = null
    completedSessionId = null
    set(workspaceScopePatch())
  },

  send: async (text, reqBase) => {
    if (get().streaming || (!text.trim() && !get().messageFiles.length && !get().attachments.length)) return
    set({ streaming: true, streamingText: '', liveTimeline: [], liveTools: [], contextCompressing: false, contextCompression: null, error: null })
    completedSessionId = null
    const req: RunAgentRequest = {
      sessionId: get().activeId ?? undefined,
      message: text.trim() || (get().messageFiles.length ? '请分析所附资料。' : ''),
      attachments: get().attachments.length ? get().attachments : undefined,
      files: get().messageFiles.length ? get().messageFiles : undefined,
      ...reqBase
    }
    runningSessionId = req.sessionId ?? null
    try {
      const { sessionId } = await getPlatformApi().agentRun(req)
      runningSessionId = sessionId
      if (!get().activeId) set({ activeId: sessionId })
      if (!shouldKeepStreamingAfterAcceptance({ accepted: true, done: false })) {
        runningSessionId = null
        set({ streaming: false })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      flushStreamingDelta()
      set({ streaming: false, streamingText: '', liveTimeline: [], liveTools: [], contextCompressing: false })
      runningSessionId = null
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
      const patch = sessionEventPatch(get().activeId, envelope)
      if (patch) set({ ...patch, attachments: [], messageFiles: [] })
      break
    }
    case 'text-delta':
      pushStreamingDelta(set, ev.messageId, ev.delta)
      break
    case 'tool-start':
      flushStreamingDelta()
      set((p) => ({
        liveTimeline: [...p.liveTimeline, { kind: 'tool', callId: ev.callId, name: ev.name, argsJson: ev.argsJson, status: 'running' }],
        liveTools: [...p.liveTools, { callId: ev.callId, name: ev.name, argsJson: ev.argsJson, status: 'running' }]
      }))
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
