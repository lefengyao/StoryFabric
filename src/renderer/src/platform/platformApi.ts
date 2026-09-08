import type { StoryFabricApi } from '../../../shared/api'
import { getAndroidApi } from './androidApi'
import { HttpPlatformApi } from './httpApi'

declare global {
  interface Window {
    api?: StoryFabricApi
    Capacitor?: {
      isNativePlatform?: () => boolean
    }
  }
}

let installedApi: StoryFabricApi | null = null
let webApi: StoryFabricApi | null = null

/** 平台启动代码可注入 Android 实现；Electron 则继续使用 preload 注入的 window.api。 */
export function installPlatformApi(api: StoryFabricApi): void {
  installedApi = api
}

/** Returns the native/local implementation even after a remote API was installed. */
export function getLocalPlatformApi(): StoryFabricApi {
  if (typeof window !== 'undefined' && window.api) return window.api
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) return getAndroidApi()
  return getPlatformApi()
}

export function getPlatformApi(): StoryFabricApi {
  if (installedApi) return installedApi
  if (typeof window !== 'undefined' && window.api) return window.api
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
    return getAndroidApi()
  }
  if (typeof window !== 'undefined') {
    webApi ??= new HttpPlatformApi()
    return webApi
  }
  throw new Error('当前平台 API 尚未初始化')
}

export function isWebPlatform(): boolean {
  return typeof window !== 'undefined' && !window.api && !window.Capacitor?.isNativePlatform?.()
}
