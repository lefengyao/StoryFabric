import { describe, expect, it } from 'vitest'
import type { StoryFabricApi } from '../../../../shared/api'
import { api } from '../../lib/api'
import { installPlatformApi } from '../platformApi'

describe('renderer platform facade', () => {
  it('preserves the platform instance when methods are called through api', async () => {
    const impl: { marker: string; getCurrentWorkspace: () => Promise<{ name: string }> } = {
      marker: 'android-instance',
      getCurrentWorkspace() {
        return Promise.resolve({ name: this.marker })
      }
    }

    installPlatformApi(impl as unknown as StoryFabricApi)
    await expect(api.getCurrentWorkspace()).resolves.toEqual({ name: 'android-instance' })
  })
})
