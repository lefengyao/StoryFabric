import { create } from 'zustand'
import type { WorkspaceSummary } from '../../../shared/types'

type Status = 'booting' | 'empty' | 'ready'

interface WorkspaceState {
  status: Status
  summary: WorkspaceSummary | null
  error: string | null

  init: () => Promise<void>
  open: (path: string) => Promise<void>
  createAndOpen: (parentDir: string, name: string) => Promise<void>
  close: () => Promise<void>
  refresh: () => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  status: 'booting',
  summary: null,
  error: null,

  init: async () => {
    try {
      const s = await window.api.getCurrentWorkspace()
      if (s) set({ status: 'ready', summary: s })
      else set({ status: 'empty' })
    } catch {
      set({ status: 'empty' })
    }
  },

  open: async (path) => {
    set({ error: null })
    try {
      const s = await window.api.openWorkspace(path)
      set({ status: 'ready', summary: s })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  createAndOpen: async (parentDir, name) => {
    const path = await window.api.createWorkspace(parentDir, name)
    await get().open(path)
  },

  close: async () => {
    await window.api.closeWorkspace()
    set({ status: 'empty', summary: null })
  },

  refresh: async () => {
    const s = await window.api.refreshWorkspace()
    if (s) set({ summary: s })
  }
}))
