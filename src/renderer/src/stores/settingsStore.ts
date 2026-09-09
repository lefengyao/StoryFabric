import { create } from 'zustand'
import type { PublicAppSettings } from '../../../shared/types'
import type { SettingsPatch } from '../../../shared/api'
import { getPlatformApi } from '../platform/platformApi'
import { accentStyle } from '../lib/accent'

interface SettingsState {
  settings: PublicAppSettings | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
  /** 取色器拖动时的即时预览：只改 CSS 变量，不落盘。 */
  previewAccent: (base: string) => void
}

const ACCENT_VARS = ['--accent', '--accent-strong', '--accent-soft', '--accent-fg']

function applyTheme(theme: 'light' | 'dark' | 'system' | undefined): void {
  const t = theme ?? 'system'
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** 主题切换后必须重新计算强调色：深浅两套基色不同。 */
function applyAccent(settings: Pick<PublicAppSettings, 'accentColorLight' | 'accentColorDark'> | null): void {
  const dark = document.documentElement.classList.contains('dark')
  const style = accentStyle(settings ?? {}, dark)
  for (const key of ACCENT_VARS) {
    const value = style[key]
    if (value) document.documentElement.style.setProperty(key, value)
    else document.documentElement.style.removeProperty(key)
  }
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
  },

  previewAccent: (base) => {
    applyAccent({ accentColorLight: base, accentColorDark: base })
  }
}))
