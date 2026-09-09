import { create } from 'zustand'
import type { PublicAppSettings } from '../../../shared/types'
import type { SettingsPatch } from '../../../shared/api'
import { getPlatformApi } from '../platform/platformApi'
import { accentStyle } from '../lib/accent'

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

/** 主题切换后必须重新计算强调色：深浅两套基色不同。 */
function applyAccent(settings: PublicAppSettings | null): void {
  const dark = document.documentElement.classList.contains('dark')
  const style = accentStyle(settings ?? {}, dark)
  for (const [key, value] of Object.entries(style)) document.documentElement.style.setProperty(key, value)
}

function applyAppearance(settings: PublicAppSettings | null): void {
  applyTheme(settings?.theme)
  applyAccent(settings)
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,

  load: async () => {
    const s = await getPlatformApi().getSettings()
    applyAppearance(s)
    set({ settings: s })
  },

  update: async (patch) => {
    const s = await getPlatformApi().updateSettings(patch)
    applyAppearance(s)
    set({ settings: s })
  }
}))
