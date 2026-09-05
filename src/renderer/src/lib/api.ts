/** 渲染器统一的平台 API 入口。Electron/Android 由启动层提供具体实现。 */
import type { StoryFabricApi } from '../../../shared/api'
import { getPlatformApi } from '../platform/platformApi'

export const api: StoryFabricApi = new Proxy({} as StoryFabricApi, {
  get: (_target, prop: keyof StoryFabricApi) => {
    const impl = getPlatformApi()
    const value = impl[prop]
    // AndroidPlatformApi uses instance fields (workspace store, agent, listeners).
    // Bind methods here so calls through the renderer facade preserve that instance.
    return typeof value === 'function' ? value.bind(impl) : value
  }
})
