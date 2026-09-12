import { create } from 'zustand'
import type { WorkspaceRequestOptions } from '../../../shared/api'
import type { WorkspaceSummary } from '../../../shared/types'
import { getPlatformApi } from '../platform/platformApi'

type Status = 'booting' | 'empty' | 'ready'

interface WorkspaceState {
  status: Status
  summary: WorkspaceSummary | null
  error: string | null

  init: () => Promise<void>
  open: (path: string, isCurrent?: () => boolean, options?: WorkspaceRequestOptions) => Promise<void>
  createAndOpen: (parentDir: string, name: string) => Promise<void>
  importArchive: (bytes: Uint8Array, fileName: string, target?: import('../../../shared/api').WorkspaceImportTarget, isCurrent?: () => boolean, options?: WorkspaceRequestOptions) => Promise<void>
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

  open: async (path, isCurrent, options) => {
    if (isCurrent?.() === false) return
    set({ error: null })
    try {
      if (isCurrent?.() === false) return
      const platform = getPlatformApi()
      if (isCurrent?.() === false) return
      const s = options ? await platform.openWorkspace(path, options) : await platform.openWorkspace(path)
      if (isCurrent?.() === false) return
      set({ status: 'ready', summary: s })
    } catch (err) {
      if (isCurrent?.() === false) return
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

  importArchive: async (bytes, fileName, target, isCurrent, options) => {
    if (isCurrent?.() !== false) set({ error: null })
    try {
      const platform = getPlatformApi()
      const s = options ? await platform.importWorkspace(bytes, fileName, target, options) : await platform.importWorkspace(bytes, fileName, target)
      if (isCurrent?.() !== false) set({ status: 'ready', summary: s, error: null })
    } catch (err) {
      if (isCurrent?.() !== false) set({ error: err instanceof Error ? err.message : String(err) })
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
