import { useEffect, useRef } from 'react'
import { normalizeUpdatePreferences } from '../../../shared/updates'
import { getPlatformApi } from '../platform/platformApi'
import { useSettings } from '../stores/settingsStore'
import { useAppUpdates } from '../stores/appUpdateStore'

const INTERVAL = 6 * 60 * 60_000
export function useAutomaticUpdates(enabled: boolean): void {
  const previousSources = useRef<string | null>(null)
  const signature = useSettings((s) => s.settings ? JSON.stringify(normalizeUpdatePreferences(s.settings.updatePreferences)) : null)
  useEffect(() => {
    if (!enabled || !signature || !getPlatformApi().checkAppUpdate) return
    const preferences = normalizeUpdatePreferences(JSON.parse(signature))
    const sources = preferences.sources.join('\n')
    if (previousSources.current !== sources) {
      previousSources.current = sources
      useAppUpdates.getState().reset()
    }
    if (!preferences.automatic) return
    const check = (): void => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false) return
      const state = useAppUpdates.getState()
      if (state.download?.status === 'downloading') return
      if (!state.result || Date.now() - state.result.checkedAt >= INTERVAL) void state.check()
    }
    const initial = window.setTimeout(check, 3000)
    const timer = window.setInterval(check, INTERVAL)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearTimeout(initial); window.clearInterval(timer)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [enabled, signature])
}
