import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { CoreSessionStore } from '../sessionStore'

describe('CoreSessionStore creative preferences', () => {
  it('persists creative preferences and returns them from load', async () => {
    const store = new MemoryFileStore()
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    await sessions.save(session)
    const creativePreferences = {
      mode: 'orchestration' as const,
      orchestrationEnabled: true,
      subagentsEnabled: false,
      intensity: 'standard' as const,
      selectedSkillIds: [],
      selectedRuleSetIds: [],
      orchestration: {
        mode: 'single' as const,
        enabled: true,
        subagentsEnabled: false,
        enabledStageIds: ['write'],
        modelByStage: {}
      }
    }

    expect(await sessions.updateMeta(session.id, { creativePreferences })).toBe(true)
    expect((await sessions.load(session.id))?.creativePreferences).toEqual(creativePreferences)
  })
})
