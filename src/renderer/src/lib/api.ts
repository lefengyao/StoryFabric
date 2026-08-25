/** window.api 的类型化访问入口 */
import type { StoryFabricApi } from '../../../shared/api'

declare global {
  interface Window {
    api: StoryFabricApi
  }
}

export const api: StoryFabricApi = window.api
