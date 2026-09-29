import { creativePreferencesFromOrchestrationDefaults, DEFAULT_CREATIVE_PREFERENCES, normalizeOrchestrationPreferences, type CreativePreferences } from '../../../shared/creative'
import type { PublicAppSettings } from '../../../shared/types'

type OrchestrationSettings = Pick<PublicAppSettings, 'orchestrationDefaults'>
export type CreativeSurface = 'sidebar' | 'workbench'

/** Converts the app-level orchestration plan into the immutable preference snapshot sent with a run. */
export function creativePreferencesFromSettings(settings: OrchestrationSettings | undefined): CreativePreferences {
  return creativePreferencesFromOrchestrationDefaults(settings?.orchestrationDefaults)
}

/** The narrow sidebar deliberately stays basic; orchestration is a full-workbench feature. */
export function creativePreferencesForSurface(settings: OrchestrationSettings | undefined, surface: CreativeSurface): CreativePreferences {
  if (surface === 'sidebar') return { ...DEFAULT_CREATIVE_PREFERENCES, selectedSkillIds: [], selectedRuleSetIds: [] }
  return creativePreferencesFromSettings(settings)
}

export function creativePreferencesForMode(current: CreativePreferences | undefined, settings: OrchestrationSettings | undefined, enabled: boolean): CreativePreferences {
  if (enabled) {
    if (current?.orchestrationEnabled) return current
    // The chat mode selector is a session-level override. It must be able to
    // turn orchestration on even when the application default is disabled.
    // Keep the configured stage/model/budget profile, but force the snapshot
    // used by this session to be enabled.
    const defaults = creativePreferencesFromSettings(settings)
    const orchestration = normalizeOrchestrationPreferences(defaults.orchestration ?? settings?.orchestrationDefaults)
    return {
      ...defaults,
      mode: 'orchestration',
      orchestrationEnabled: true,
      subagentsEnabled: orchestration.subagentsEnabled,
      orchestration: { ...orchestration, enabled: true }
    }
  }
  return {
    ...DEFAULT_CREATIVE_PREFERENCES,
    selectedSkillIds: current?.selectedSkillIds ?? [],
    selectedRuleSetIds: current?.selectedRuleSetIds ?? []
  }
}

/** Applies changed app-level budget defaults to the currently open orchestration session. */
export function syncOrchestrationBudget(current: CreativePreferences | undefined, settings: OrchestrationSettings | undefined): CreativePreferences | undefined {
  if (!current?.orchestration) return current
  const defaults = normalizeOrchestrationPreferences(settings?.orchestrationDefaults)
  return {
    ...current,
    orchestration: {
      ...current.orchestration,
      maxCalls: defaults.maxCalls,
      maxEstimatedTokens: defaults.maxEstimatedTokens
    }
  }
}
