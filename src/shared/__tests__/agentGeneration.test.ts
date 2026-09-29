import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_GENERATION_PREFERENCES,
  agentTemperatureToRawModelTemperature,
  normalizeAgentGenerationPreferences,
} from '../agentGeneration'

describe('agent generation preferences', () => {
  it('defaults and clamps persisted values', () => {
    expect(DEFAULT_AGENT_GENERATION_PREFERENCES).toEqual({ agentTemperature: 70, proseAlternativesEnabled: false, maxToolRounds: 100 })
    expect(normalizeAgentGenerationPreferences({ agentTemperature: 101, proseAlternativesEnabled: 'true' }))
      .toEqual({ agentTemperature: 100, proseAlternativesEnabled: false, maxToolRounds: 100 })
    expect(normalizeAgentGenerationPreferences({ agentTemperature: Number.NaN, proseAlternativesEnabled: true }))
      .toEqual({ agentTemperature: 70, proseAlternativesEnabled: true, maxToolRounds: 100 })
    expect(normalizeAgentGenerationPreferences({ maxToolRounds: 250 })).toMatchObject({ maxToolRounds: 250 })
    expect(normalizeAgentGenerationPreferences({ maxToolRounds: 0 })).toMatchObject({ maxToolRounds: 1 })
    expect(normalizeAgentGenerationPreferences({ maxToolRounds: 5000 })).toMatchObject({ maxToolRounds: 1000 })
    expect(normalizeAgentGenerationPreferences({ maxToolRounds: 12.5 })).toMatchObject({ maxToolRounds: 100 })
  })

  it('maps clamped product values linearly to raw model temperature without rounding decimals', () => {
    expect(agentTemperatureToRawModelTemperature(0)).toBe(1.2)
    expect(agentTemperatureToRawModelTemperature(0.5)).toBe(1.195)
    expect(agentTemperatureToRawModelTemperature(70)).toBe(0.5)
    expect(agentTemperatureToRawModelTemperature(100)).toBe(0.2)
    expect(agentTemperatureToRawModelTemperature(-10)).toBe(1.2)
    expect(agentTemperatureToRawModelTemperature(120)).toBe(0.2)
  })
})
