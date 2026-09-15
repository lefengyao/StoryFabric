import { create } from 'zustand'
import type { RunEventEnvelope } from '../../../shared/agentRuntime'

export interface RunUiState {
  runId: string
  status: 'created' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  events: RunEventEnvelope[]
  partialByMessage: Record<string, string>
}

interface RunStoreState {
  runs: Record<string, RunUiState>
  activeRunId: string | null
  begin: (runId: string) => boolean
  applyEvent: (event: RunEventEnvelope) => void
  clear: (runId?: string) => void
}

export const useRunStore = create<RunStoreState>((set, get) => ({
  runs: {},
  activeRunId: null,
  begin: (runId) => {
    if (get().activeRunId && get().runs[get().activeRunId!]?.status === 'running') return false
    set((state) => ({ runs: { ...state.runs, [runId]: { runId, status: 'running', events: [], partialByMessage: {} } }, activeRunId: runId }))
    return true
  },
  applyEvent: (event) => set((state) => {
    const current = state.runs[event.runId] ?? { runId: event.runId, status: 'created' as const, events: [], partialByMessage: {} }
    if (current.events.some((item) => item.seq === event.seq)) return state
    const nextEvents = [...current.events, event].sort((a, b) => a.seq - b.seq)
    const next = { ...current, events: nextEvents, partialByMessage: nextEvents.reduce<Record<string, string>>((partials, item) => {
      if (item.event.type === 'text-delta' && item.event.messageId && item.event.delta) partials[item.event.messageId] = `${partials[item.event.messageId] ?? ''}${item.event.delta}`
      return partials
    }, {}) }
    if (event.event.type === 'run-start') next.status = 'running'
    if (event.event.type === 'run-paused') next.status = 'paused'
    if (event.event.type === 'run-error') next.status = 'failed'
    if (event.event.type === 'run-done') {
      const status = (event.event.payload as { status?: string } | undefined)?.status
      next.status = status === 'cancelled' || status === 'interrupted' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed'
    }
    return { runs: { ...state.runs, [event.runId]: next } }
  }),
  clear: (runId) => set((state) => runId ? { runs: Object.fromEntries(Object.entries(state.runs).filter(([id]) => id !== runId)), activeRunId: state.activeRunId === runId ? null : state.activeRunId } : { runs: {}, activeRunId: null })
}))
