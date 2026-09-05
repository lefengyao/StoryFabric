import { create } from 'zustand'
import type { WorkspaceSummary } from '../../../shared/types'
import { getPlatformApi } from '../platform/platformApi'

type Status = 'booting' | 'empty' | 'ready'

interface WorkspaceState {
  status: Status
  summary: WorkspaceSummary | null
  error: string | null

  init: () => Promise<void>
  open: (path: string) => Promise<void>
  createAndOpen: (parentDir: string, name: string) => Promise<void>
  importArchive: (base64: string, fileName: string) => Promise<void>
  close: () => Promise<void>
  refresh: () => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  status: 'booting',
  summary: null,
  error: null,

  init: async () => {
    try {
      const s = await getPlatformApi().getCurrentWorkspace()
      if (s) set({ status: 'ready', summary: s })
      else set({ status: 'empty' })
    } catch {
      set({ status: 'empty' })
    }
  },

  open: async (path) => {
    set({ error: null })
    try {
      const s = await getPlatformApi().openWorkspace(path)
      set({ status: 'ready', summary: s })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  createAndOpen: async (parentDir, name) => {
    set({ error: null })
    try {
      const path = await getPlatformApi().createWorkspace(parentDir, name)
      await get().open(path)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  importArchive: async (base64, fileName) => {
    set({ error: null })
    try {
      const s = await getPlatformApi().importWorkspace(base64, fileName)
      set({ status: 'ready', summary: s, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  close: async () => {
    await getPlatformApi().closeWorkspace()
    set({ status: 'empty', summary: null })
  },

  refresh: async () => {
    const s = await getPlatformApi().refreshWorkspace()
    if (s) set({ summary: s })
  }
}))
