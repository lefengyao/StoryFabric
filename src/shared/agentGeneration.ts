import { MAX_TOOL_ROUNDS } from './types'

export interface AgentGenerationPreferences {
  agentTemperature: number
  proseAlternativesEnabled: boolean
  /** 普通模式中允许模型连续调用工具的轮数。 */
  maxToolRounds?: number
  polishAgentEnabled?: boolean
  deAiAgentEnabled?: boolean
}

export const MAX_CONFIGURABLE_TOOL_ROUNDS = 1000

export const DEFAULT_AGENT_GENERATION_PREFERENCES: AgentGenerationPreferences = {
  agentTemperature: 70,
  proseAlternativesEnabled: false,
  maxToolRounds: MAX_TOOL_ROUNDS
}

export function normalizeAgentGenerationPreferences(value: unknown): AgentGenerationPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const raw = typeof input.agentTemperature === 'number' && Number.isFinite(input.agentTemperature)
    ? input.agentTemperature
    : DEFAULT_AGENT_GENERATION_PREFERENCES.agentTemperature
  const rawMaxToolRounds = typeof input.maxToolRounds === 'number' && Number.isInteger(input.maxToolRounds)
    ? input.maxToolRounds
    : MAX_TOOL_ROUNDS
  const result: AgentGenerationPreferences = {
    agentTemperature: Math.round(Math.max(0, Math.min(100, raw))),
    proseAlternativesEnabled: input.proseAlternativesEnabled === true,
    maxToolRounds: Math.max(1, Math.min(MAX_CONFIGURABLE_TOOL_ROUNDS, rawMaxToolRounds))
  }
  if (Object.prototype.hasOwnProperty.call(input, 'polishAgentEnabled')) result.polishAgentEnabled = input.polishAgentEnabled !== false
  if (Object.prototype.hasOwnProperty.call(input, 'deAiAgentEnabled')) result.deAiAgentEnabled = input.deAiAgentEnabled !== false
  return result
}

export function agentTemperatureToRawModelTemperature(value: number): number {
  const temperature = typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : DEFAULT_AGENT_GENERATION_PREFERENCES.agentTemperature
  return (120 - temperature) / 100
}
