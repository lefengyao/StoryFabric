import { create } from 'zustand'
import type { PublicAppSettings } from '../../../shared/types'
import type { SettingsPatch } from '../../../shared/api'

interface SettingsState {
  settings: PublicAppSettings | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
}

function applyTheme(theme: 'light' | 'dark' | 'system' | undefined): void {
  const t = theme ?? 'system'
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,

  load: async () => {
    const s = await window.api.getSettings()
    applyTheme(s.theme)
    set({ settings: s })
  },

  update: async (patch) => {
    const s = await window.api.updateSettings(patch)
    applyTheme(s.theme)
    set({ settings: s })
  }
}))
