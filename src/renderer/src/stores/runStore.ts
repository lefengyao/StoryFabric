import { create } from 'zustand'
import type { RunEventEnvelope } from '../../../shared/agentRuntime'
import type { RunReplay } from '../../../shared/runEvents'

export interface RunUiState {
  runId: string
  status: 'created' | 'running' | 'awaiting_user' | 'paused' | 'completed' | 'failed' | 'cancelled'
  events: RunEventEnvelope[]
  eventBytes: number
  lastSeq: number
  evictedThroughSeq: number
  partialByMessage: Record<string, string>
  /** Text from events already evicted from the bounded recent-event window. */
  partialBaseByMessage: Record<string, string>
}

const MAX_RECENT_RUN_EVENTS = 2000
const MAX_RECENT_RUN_EVENT_BYTES = 512 * 1024
const MAX_PARTIAL_MESSAGES = 16
const MAX_PARTIAL_CHARS_PER_MESSAGE = 16_000
const MAX_RETAINED_NONTERMINAL_RUNS = 8
/** Retain at most eight terminal and eight nonterminal runs in the renderer. */
const MAX_RETAINED_TERMINAL_RUNS = 8

function isTerminalRun(status: RunUiState['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function retainRecentRuns(runs: Record<string, RunUiState>, activeRunId: string | null, recentlyUpdatedRunId: string): Record<string, RunUiState> {
  const order = [...Object.keys(runs).filter((runId) => runId !== recentlyUpdatedRunId), recentlyUpdatedRunId]
  const terminalIds = order.filter((runId) => isTerminalRun(runs[runId].status))
  const nonterminalIds = order.filter((runId) => !isTerminalRun(runs[runId].status))
  const recentSet = (ids: string[], limit: number, protectedId?: string): Set<string> => {
    const kept = ids.slice(-limit)
    if (protectedId && ids.includes(protectedId) && !kept.includes(protectedId)) {
      kept.shift()
      kept.push(protectedId)
    }
    return new Set(kept)
  }
  const keepTerminal = recentSet(terminalIds, MAX_RETAINED_TERMINAL_RUNS, isTerminalRun(runs[activeRunId ?? '']?.status) ? activeRunId ?? undefined : undefined)
  const keepNonterminal = recentSet(nonterminalIds, MAX_RETAINED_NONTERMINAL_RUNS, activeRunId && !isTerminalRun(runs[activeRunId]?.status) ? activeRunId : undefined)
  return Object.fromEntries(Object.entries(runs).filter(([runId]) => keepTerminal.has(runId) || keepNonterminal.has(runId)))
}

function appendPartial(partials: Record<string, string>, item: RunEventEnvelope): void {
  if (item.event.type !== 'text-delta' || !item.event.messageId || !item.event.delta) return
  const key = runMessageKey({ ...item, messageId: item.event.messageId })
  const next = `${partials[key] ?? ''}${item.event.delta}`
  partials[key] = next.length > MAX_PARTIAL_CHARS_PER_MESSAGE ? next.slice(-MAX_PARTIAL_CHARS_PER_MESSAGE) : next
  while (Object.keys(partials).length > MAX_PARTIAL_MESSAGES) delete partials[Object.keys(partials)[0]]
}

function eventBytes(event: RunEventEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength
}

export function runMessageKey(event: Pick<RunEventEnvelope, 'workspaceId' | 'runId' | 'agentId'> & { messageId: string }): string {
  return `${event.workspaceId}:${event.runId}:${event.agentId}:${event.messageId}`
}

interface RunStoreState {
  runs: Record<string, RunUiState>
  activeRunId: string | null
  begin: (runId: string) => boolean
  applyEvent: (event: RunEventEnvelope) => void
  clear: (runId?: string) => void
}

export interface RuntimeRecoveryApi {
  recoverRunEvents?: (runId: string, afterSeq?: number) => Promise<RunReplay>
}

export async function recoverActiveRun(api: RuntimeRecoveryApi, runId = useRunStore.getState().activeRunId): Promise<void> {
  if (!runId || !api.recoverRunEvents) return
  const current = useRunStore.getState().runs[runId]
  const afterSeq = current?.lastSeq ?? current?.events.at(-1)?.seq ?? 0
  const replay = await api.recoverRunEvents(runId, afterSeq)
  if (!replay.replayable) return
  for (const event of replay.events.toSorted((a, b) => a.seq - b.seq)) {
    if (event.runId === runId) useRunStore.getState().applyEvent(event)
  }
}

export const useRunStore = create<RunStoreState>((set, get) => ({
  runs: {},
  activeRunId: null,
  begin: (runId) => {
    if (get().activeRunId && get().runs[get().activeRunId!]?.status === 'running') return false
    set((state) => ({ runs: { ...state.runs, [runId]: { runId, status: 'running', events: [], eventBytes: 0, lastSeq: 0, evictedThroughSeq: 0, partialByMessage: {}, partialBaseByMessage: {} } }, activeRunId: runId }))
    return true
  },
  applyEvent: (event) => set((state) => {
    const current = state.runs[event.runId] ?? { runId: event.runId, status: 'created' as const, events: [], eventBytes: 0, lastSeq: 0, evictedThroughSeq: 0, partialByMessage: {}, partialBaseByMessage: {} }
    const lastSeq = current.lastSeq ?? current.events.at(-1)?.seq ?? 0
    const evictedThroughSeq = current.evictedThroughSeq ?? 0
    const inOrder = event.seq > lastSeq
    if (!inOrder && (current.events.some((item) => item.seq === event.seq) || event.seq <= evictedThroughSeq)) return state
    const events = inOrder ? [...current.events, event] : [...current.events, event].sort((a, b) => a.seq - b.seq)
    let retainedBytes = inOrder ? (current.eventBytes ?? current.events.reduce((sum, item) => sum + eventBytes(item), 0)) + eventBytes(event) : events.reduce((sum, item) => sum + eventBytes(item), 0)
    const evicted: RunEventEnvelope[] = []
    let nextEvictedThroughSeq = evictedThroughSeq
    while (events.length > MAX_RECENT_RUN_EVENTS || retainedBytes > MAX_RECENT_RUN_EVENT_BYTES) {
      const removed = events.shift()
      if (!removed) break
      retainedBytes -= eventBytes(removed)
      evicted.push(removed)
      nextEvictedThroughSeq = Math.max(nextEvictedThroughSeq, removed.seq)
    }
    const partialBaseByMessage = { ...current.partialBaseByMessage }
    for (const item of evicted) appendPartial(partialBaseByMessage, item)
    const partialByMessage = inOrder ? { ...current.partialByMessage } : { ...partialBaseByMessage }
    if (inOrder) appendPartial(partialByMessage, event)
    else for (const item of events) appendPartial(partialByMessage, item)
    const next = { ...current, events, eventBytes: Math.max(0, retainedBytes), lastSeq: Math.max(lastSeq, event.seq), evictedThroughSeq: nextEvictedThroughSeq, partialByMessage, partialBaseByMessage }
    if (inOrder) {
      if (event.event.type === 'run-start') next.status = 'running'
      if (event.event.type === 'agent-question' || event.event.type === 'skill-candidate' || event.event.type === 'waiting-user') next.status = 'awaiting_user'
      if ((event.event.type === 'text-delta' || event.event.type === 'tool-generating' || event.event.type === 'tool-complete') && (next.status === 'awaiting_user' || next.status === 'created')) next.status = 'running'
      if (event.event.type === 'run-paused') next.status = 'paused'
      if (event.event.type === 'run-error') next.status = 'failed'
      if (event.event.type === 'run-done') {
        const status = (event.event.payload as { status?: string } | undefined)?.status
        next.status = status === 'cancelled' || status === 'interrupted' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed'
      }
    }
    const activeRunId = (inOrder && event.event.type === 'run-start') || !state.activeRunId ? event.runId : state.activeRunId
    return {
      runs: retainRecentRuns({ ...state.runs, [event.runId]: next }, activeRunId, event.runId),
      activeRunId
    }
  }),
  clear: (runId) => set((state) => runId ? { runs: Object.fromEntries(Object.entries(state.runs).filter(([id]) => id !== runId)), activeRunId: state.activeRunId === runId ? null : state.activeRunId } : { runs: {}, activeRunId: null })
}))
