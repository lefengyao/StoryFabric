import { create } from 'zustand'
import type { PublicAppSettings } from '../../../shared/types'
import type { SettingsPatch } from '../../../shared/api'
import { getPlatformApi } from '../platform/platformApi'
import { accentStyle } from '../lib/accent'
import { editorStyle } from '../lib/editorStyle'
import { chatTypographyStyle } from '../lib/chatTypography'

interface SettingsState {
  settings: PublicAppSettings | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
  /** 取色器拖动时的即时预览：只改 CSS 变量，不落盘。 */
  previewAccent: (base: string) => void
}

type SettingsUpdatedListener = (settings: PublicAppSettings, patch: SettingsPatch) => void | Promise<void>
const settingsUpdatedListeners = new Set<SettingsUpdatedListener>()

export function onSettingsUpdated(listener: SettingsUpdatedListener): () => void {
  settingsUpdatedListeners.add(listener)
  return () => settingsUpdatedListeners.delete(listener)
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
  applyEditor(settings)
  applyChatTypography(settings)
}

const EDITOR_VARS = ['--editor-font-size', '--editor-line-height', '--editor-font']

/** 编辑器字号/行距/字体：写成 CSS 变量，由 index.css 的 .cm-scroller 消费。 */
function applyEditor(settings: PublicAppSettings | null): void {
  const style = editorStyle(settings ?? {})
  for (const key of EDITOR_VARS) document.documentElement.style.setProperty(key, style[key])
}

const CHAT_TYPOGRAPHY_VARS = ['--chat-font-size', '--chat-font-meta-size', '--chat-font-micro-size']

function applyChatTypography(settings: PublicAppSettings | null): void {
  const style = chatTypographyStyle(settings ?? {})
  for (const key of CHAT_TYPOGRAPHY_VARS) document.documentElement.style.setProperty(key, style[key])
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
    await Promise.all([...settingsUpdatedListeners].map((listener) => Promise.resolve(listener(s, patch)).catch(() => undefined)))
  },

  previewAccent: (base) => {
    applyAccent({ accentColorLight: base, accentColorDark: base })
  }
}))
