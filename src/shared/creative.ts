export type CreativeMode = 'basic' | 'orchestration'
export type CreativeIntensity = 'light' | 'standard' | 'strong'
export type OrchestrationMode = 'multi' | 'single'

export interface CreativePackageSummary {
  id: string
  version: string
  name: string
  description: string
  enabled: boolean
  skills: string[]
  ruleSets: string[]
}

export interface OrchestrationPreferences {
  /** Multi-agent orchestration is the backwards-compatible default. */
  mode?: OrchestrationMode
  enabled: boolean
  subagentsEnabled: boolean
  enabledStageIds: string[]
  modelByStage: Record<string, { providerId: string; model: string }>
  maxCalls?: number
  maxEstimatedTokens?: number
}

export type NormalizedOrchestrationPreferences = OrchestrationPreferences & { mode: OrchestrationMode }

export const DEFAULT_ORCHESTRATION_PREFERENCES: NormalizedOrchestrationPreferences = {
  mode: 'multi',
  enabled: false,
  subagentsEnabled: false,
  enabledStageIds: ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'],
  modelByStage: {},
  maxCalls: 24,
  maxEstimatedTokens: 300000
}
export interface CreativePreferences {
  mode: CreativeMode
  orchestrationEnabled: boolean
  subagentsEnabled: boolean
  intensity: CreativeIntensity
  selectedSkillIds: string[]
  selectedRuleSetIds: string[]
  orchestration?: OrchestrationPreferences
}

export const DEFAULT_CREATIVE_PREFERENCES: CreativePreferences = {
  mode: 'basic',
  orchestrationEnabled: false,
  subagentsEnabled: false,
  intensity: 'standard',
  selectedSkillIds: [],
  selectedRuleSetIds: []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function normalizeModels(value: unknown): Record<string, { providerId: string; model: string }> {
  if (!isRecord(value)) return {}
  const result: Record<string, { providerId: string; model: string }> = {}
  for (const [stageId, model] of Object.entries(value)) {
    if (!isRecord(model) || typeof model.providerId !== 'string' || !model.providerId || typeof model.model !== 'string' || !model.model) continue
    result[stageId] = { providerId: model.providerId, model: model.model }
  }
  return result
}

/** Settings-level orchestration profile shared by desktop, web, and Android. */
export function normalizeOrchestrationPreferences(value: unknown): NormalizedOrchestrationPreferences {
  if (!isRecord(value)) return {
    ...DEFAULT_ORCHESTRATION_PREFERENCES,
    enabledStageIds: [...DEFAULT_ORCHESTRATION_PREFERENCES.enabledStageIds],
    modelByStage: {}
  }

  const enabledStageIds = stringList(value.enabledStageIds)
  const configuredBudget = positiveInteger(value.maxEstimatedTokens)
  return {
    mode: value.mode === 'single' ? 'single' : 'multi',
    enabled: value.enabled === true,
    subagentsEnabled: value.subagentsEnabled === true,
    enabledStageIds: Array.isArray(value.enabledStageIds) ? enabledStageIds : [...DEFAULT_ORCHESTRATION_PREFERENCES.enabledStageIds],
    modelByStage: normalizeModels(value.modelByStage),
    maxCalls: positiveInteger(value.maxCalls) ?? DEFAULT_ORCHESTRATION_PREFERENCES.maxCalls,
    // 100k was the old bundled default; migrate it so existing profiles can
    // finish a full multi-stage run without silently changing other custom limits.
    maxEstimatedTokens: configuredBudget === 100000 ? DEFAULT_ORCHESTRATION_PREFERENCES.maxEstimatedTokens : configuredBudget ?? DEFAULT_ORCHESTRATION_PREFERENCES.maxEstimatedTokens
  }
}
export function normalizeCreativePreferences(value: unknown): CreativePreferences {
  if (!isRecord(value)) return { ...DEFAULT_CREATIVE_PREFERENCES }

  const orchestrationValue = isRecord(value.orchestration) ? value.orchestration : undefined
  const orchestrationEnabled = value.orchestrationEnabled === true || value.mode === 'orchestration' || orchestrationValue?.enabled === true
  const subagentsEnabled = value.subagentsEnabled === true || orchestrationValue?.subagentsEnabled === true
  const mode: CreativeMode = orchestrationEnabled ? 'orchestration' : 'basic'
  const intensity: CreativeIntensity = value.intensity === 'light' || value.intensity === 'strong' ? value.intensity : 'standard'
  const result: CreativePreferences = {
    mode,
    orchestrationEnabled,
    subagentsEnabled,
    intensity,
    selectedSkillIds: stringList(value.selectedSkillIds),
    selectedRuleSetIds: stringList(value.selectedRuleSetIds)
  }

  if (orchestrationValue || orchestrationEnabled) {
    const orchestration = normalizeOrchestrationPreferences(orchestrationValue)
    const configuredBudget = positiveInteger(orchestrationValue?.maxEstimatedTokens ?? value.maxEstimatedTokens)
    result.orchestration = {
      ...orchestration,
      enabled: orchestrationEnabled,
      subagentsEnabled,
      maxCalls: positiveInteger(orchestrationValue?.maxCalls ?? value.maxCalls) ?? orchestration.maxCalls,
      maxEstimatedTokens: configuredBudget === 100000 ? DEFAULT_ORCHESTRATION_PREFERENCES.maxEstimatedTokens : configuredBudget ?? orchestration.maxEstimatedTokens
    }
  }
  return result
}

export function validateCreativePreferences(value: unknown): CreativePreferences {
  if (!isRecord(value)) throw new Error('creative 偏好必须是对象')
  if (value.mode !== undefined && value.mode !== 'basic' && value.mode !== 'orchestration') throw new Error('creative.mode 无效')
  if (value.intensity !== undefined && value.intensity !== 'light' && value.intensity !== 'standard' && value.intensity !== 'strong') throw new Error('creative.intensity 无效')
  for (const key of ['selectedSkillIds', 'selectedRuleSetIds']) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string' || !item.trim()))) throw new Error(`creative.${key} 无效`)
  }
  return normalizeCreativePreferences(value)
}
