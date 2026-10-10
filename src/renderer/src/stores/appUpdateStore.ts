import { create } from 'zustand'
import { getPlatformApi } from '../platform/platformApi'
import { APP_VERSION } from '../lib/appVersion'
import type { UpdateCheckResult, UpdateDownloadState } from '../../../shared/updates'

interface AppUpdateState {
  checking: boolean
  result: UpdateCheckResult | null
  download: UpdateDownloadState | null
  check: () => Promise<void>
  reset: () => void
  syncDownload: () => Promise<void>
  startDownload: () => Promise<void>
  cancelDownload: () => Promise<void>
}
let generation = 0
let pending: Promise<void> | null = null
export const useAppUpdates = create<AppUpdateState>((set) => ({
  checking: false, result: null, download: null,
  reset: () => { generation++; pending = null; set({ checking: false, result: null }) },
  check: () => {
    if (pending) return pending
    const platform = getPlatformApi()
    if (!platform.checkAppUpdate) return Promise.resolve()
    const current = generation
    set({ checking: true })
    pending = (async () => {
      try {
        const result = await platform.checkAppUpdate!()
        if (current === generation) set({ result })
      } catch {
        if (current === generation) set({ result: { status: 'error', currentVersion: APP_VERSION, platform: 'windows', checkedAt: Date.now(), issues: [{ source: '', message: '检测失败，请检查网络后重试' }] } })
      } finally {
        if (current === generation) { pending = null; set({ checking: false }) }
      }
    })()
    return pending
  },
  syncDownload: async () => {
    const download = await getPlatformApi().getUpdateDownloadState?.()
    if (download) set({ download })
  },
  startDownload: async () => {
    const download = await getPlatformApi().downloadAppUpdate?.()
    if (download) set({ download })
  },
  cancelDownload: async () => {
    const download = await getPlatformApi().cancelAppUpdateDownload?.()
    if (download) set({ download })
  }
}))
