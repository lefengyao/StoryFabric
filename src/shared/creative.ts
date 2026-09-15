export type CreativeMode = 'basic' | 'orchestration'
export type CreativeIntensity = 'light' | 'standard' | 'strong'

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
  enabled: boolean
  subagentsEnabled: boolean
  enabledStageIds: string[]
  modelByStage: Record<string, { providerId: string; model: string }>
  maxCalls?: number
  maxEstimatedTokens?: number
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
    result.orchestration = {
      enabled: orchestrationEnabled,
      subagentsEnabled,
      enabledStageIds: stringList(orchestrationValue?.enabledStageIds),
      modelByStage: normalizeModels(orchestrationValue?.modelByStage),
      maxCalls: positiveInteger(orchestrationValue?.maxCalls ?? value.maxCalls),
      maxEstimatedTokens: positiveInteger(orchestrationValue?.maxEstimatedTokens ?? value.maxEstimatedTokens)
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
