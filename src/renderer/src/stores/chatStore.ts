import { create } from 'zustand'
import type { AgentEventEnvelope } from '../../../shared/api'
import type {
  Attachment,
  ChatMessage,
  ChatSession,
  PendingChange,
  RunAgentRequest,
  SessionMeta
} from '../../../shared/types'
import { useWorkspace } from './workspaceStore'
import type { ToolCallData } from '../../../shared/types'

/** 流式期间的临时工具调用展示项 */
export interface LiveToolRun {
  callId: string
  name: string
  argsJson: string
  status: 'running' | 'ok' | 'error'
  preview?: string
}

interface ChatState {
  sessions: SessionMeta[]
  activeId: string | null
  messages: ChatMessage[]
  /** 正在流式生成的助手草稿 */
  streamingText: string
  streaming: boolean
  liveTools: LiveToolRun[]
  pendingChange: PendingChange | null
  /** 最近一次推送给用户确认的变更（change-applied 时据此识别） */
  lastPendingChange: PendingChange | null
  /** 最近一次被用户确认写入的变更（供编辑页联动重载） */
  lastAppliedChange: PendingChange | null
  attachments: Attachment[]
  error: string | null

  initSessions: () => Promise<void>
  openSession: (id: string) => Promise<void>
  newSession: () => void
  removeSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  setArchived: (id: string, archived: boolean) => Promise<void>
  setAttachments: (a: Attachment[]) => void

  send: (text: string, req: Omit<RunAgentRequest, 'message' | 'sessionId' | 'attachments'>) => Promise<void>
  confirmChange: (approved: boolean) => Promise<void>
  abort: () => Promise<void>

  /** 全局事件订阅（App 挂载时调用一次） */
  bindEvents: () => () => void
}

type SetFn = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void

let runningSessionId: string | null = null

async function reloadSessions(set: (p: Partial<ChatState>) => void): Promise<SessionMeta[]> {
  try {
    const sessions = await window.api.listSessions()
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
  streamingText: '',
  streaming: false,
  liveTools: [],
  pendingChange: null,
  lastPendingChange: null,
  lastAppliedChange: null,
  attachments: [],
  error: null,

  initSessions: async () => {
    await reloadSessions(set)
    const first = get().sessions[0]
    if (first && !get().activeId) await get().openSession(first.id)
  },

  openSession: async (id) => {
    if (get().streaming) return
    const s = await window.api.loadSession(id)
    if (!s) return
    applySession(set, s)
  },

  newSession: () => {
    if (get().streaming) return
    set({ activeId: null, messages: [], streamingText: '', liveTools: [], pendingChange: null, error: null })
  },

  removeSession: async (id) => {
    await window.api.deleteSession(id)
    await reloadSessions(set)
    if (get().activeId === id) get().newSession()
  },

  renameSession: async (id, title) => {
    const t = title.trim()
    if (!t) return
    await window.api.updateSession(id, { title: t })
    await reloadSessions(set)
  },

  setArchived: async (id, archived) => {
    await window.api.updateSession(id, { archived })
    await reloadSessions(set)
    if (archived && get().activeId === id) get().newSession()
  },

  setAttachments: (attachments) => set({ attachments }),

  send: async (text, reqBase) => {
    if (get().streaming || !text.trim()) return
    set({ streaming: true, streamingText: '', liveTools: [], error: null })
    const req: RunAgentRequest = {
      sessionId: get().activeId ?? undefined,
      message: text,
      attachments: get().attachments.length ? get().attachments : undefined,
      ...reqBase
    }
    runningSessionId = req.sessionId ?? null
    try {
      const { sessionId } = await window.api.agentRun(req)
      // run 完成后以磁盘上的会话为准刷新
      const s = await window.api.loadSession(sessionId)
      if (s && sessionId === get().activeId) applySession(set, s)
      else if (s && !get().activeId) {
        set({ activeId: sessionId })
        applySession(set, s)
      }
      runningSessionId = null
      await reloadSessions(set)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ streaming: false, streamingText: '', liveTools: [] })
    }
  },

  confirmChange: async (approved) => {
    const change = get().pendingChange
    if (!change) return
    set({ pendingChange: null })
    await window.api.agentConfirm(change.id, approved)
    if (approved) await useWorkspaceRefresh()
  },

  abort: async () => {
    const id = get().activeId ?? runningSessionId
    if (id) await window.api.agentAbort(id)
  },

  bindEvents: () => {
    return window.api.onAgentEvent((envelope: AgentEventEnvelope) => handleEvent(envelope, set, get))
  }
}))

function applySession(
  set: (p: Partial<ChatState>) => void,
  s: ChatSession
): void {
  set({ activeId: s.id, messages: s.messages, streamingText: '', liveTools: [], pendingChange: null })
}

function useWorkspaceRefresh(): Promise<void> {
  return useWorkspace.getState().refresh()
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
      if (!get().activeId) set({ activeId: envelope.sessionId, messages: ev.session.messages })
      break
    }
    case 'text-delta':
      set((p) => ({ streamingText: (p.streamingText ?? '') + ev.delta }))
      break
    case 'tool-start':
      set((p) => ({
        liveTools: [...p.liveTools, { callId: ev.callId, name: ev.name, argsJson: ev.argsJson, status: 'running' }]
      }))
      break
    case 'tool-done':
      set((p) => ({
        liveTools: p.liveTools.map((t) =>
          t.callId === ev.callId ? { ...t, status: ev.ok ? ('ok' as const) : ('error' as const), preview: ev.resultPreview } : t
        )
      }))
      break
    case 'pending-change':
      set({ pendingChange: ev.change, lastPendingChange: ev.change })
      break
    case 'change-applied':
      if (get().pendingChange?.id === ev.changeId) set({ pendingChange: null })
      if (ev.approved && get().lastPendingChange?.id === ev.changeId) {
        set({ lastAppliedChange: get().lastPendingChange })
      }
      break
    case 'error':
      set({ error: ev.message })
      break
    case 'done':
      break
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
