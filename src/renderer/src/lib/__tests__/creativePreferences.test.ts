import { describe, expect, it } from 'vitest'
import { creativePreferencesForMode, creativePreferencesForSurface, creativePreferencesFromSettings, syncOrchestrationBudget } from '../creativePreferences'

describe('creativePreferencesFromSettings', () => {
  it('keeps a chat in basic mode until the settings profile enables orchestration', () => {
    expect(creativePreferencesFromSettings(undefined)).toMatchObject({
      mode: 'basic',
      orchestrationEnabled: false,
      subagentsEnabled: false
    })
  })

  it('uses the saved stage and model assignments once orchestration is enabled', () => {
    expect(creativePreferencesFromSettings({
      orchestrationDefaults: {
        enabled: true,
        subagentsEnabled: true,
        enabledStageIds: ['plan', 'write', 'review'],
        modelByStage: { write: { providerId: 'writer', model: 'novel-model' } },
        maxCalls: 18,
        maxEstimatedTokens: 72000
      }
    })).toMatchObject({
      mode: 'orchestration',
      orchestrationEnabled: true,
      subagentsEnabled: true,
      orchestration: {
        enabledStageIds: ['plan', 'write', 'review'],
        modelByStage: { write: { providerId: 'writer', model: 'novel-model' } },
        maxCalls: 18,
        maxEstimatedTokens: 72000
      }
    })
  })

  it('keeps the compact sidebar in basic mode and leaves orchestration to the full workbench', () => {
    const settings = { orchestrationDefaults: { enabled: true, subagentsEnabled: true, enabledStageIds: ['plan'], modelByStage: {}, maxCalls: 8, maxEstimatedTokens: 12000 } }
    expect(creativePreferencesForSurface(settings, 'sidebar')).toMatchObject({ mode: 'basic', orchestrationEnabled: false, subagentsEnabled: false })
    expect(creativePreferencesForSurface(settings, 'workbench')).toMatchObject({ mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: true })
  })

  it('allows a chat session to enable orchestration even when the app default is off', () => {
    const next = creativePreferencesForMode(undefined, {
      orchestrationDefaults: {
        enabled: false,
        subagentsEnabled: true,
        enabledStageIds: ['plan', 'write'],
        modelByStage: { write: { providerId: 'writer', model: 'writer-model' } },
        maxCalls: 12,
        maxEstimatedTokens: 48000
      }
    }, true)

    expect(next).toMatchObject({
      mode: 'orchestration',
      orchestrationEnabled: true,
      subagentsEnabled: true,
      orchestration: {
        enabled: true,
        enabledStageIds: ['plan', 'write'],
        modelByStage: { write: { providerId: 'writer', model: 'writer-model' } },
        maxCalls: 12,
        maxEstimatedTokens: 48000
      }
    })
  })

  it('updates an active orchestration session budget while preserving its stage choices', () => {
    const current = creativePreferencesFromSettings({
      orchestrationDefaults: {
        enabled: true,
        subagentsEnabled: true,
        enabledStageIds: ['plan', 'write'],
        modelByStage: { write: { providerId: 'writer', model: 'writer-model' } },
        maxCalls: 24,
        maxEstimatedTokens: 30000000
      }
    })

    expect(syncOrchestrationBudget(current, {
      orchestrationDefaults: {
        enabled: true,
        subagentsEnabled: true,
        enabledStageIds: ['plan', 'setting', 'write'],
        modelByStage: {},
        maxCalls: 300,
        maxEstimatedTokens: 30000000
      }
    })).toMatchObject({
      orchestration: {
        maxCalls: 300,
        maxEstimatedTokens: 30000000,
        enabledStageIds: ['plan', 'write'],
        modelByStage: { write: { providerId: 'writer', model: 'writer-model' } }
      }
    })
  })
})
