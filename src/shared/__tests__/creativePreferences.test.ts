import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORCHESTRATION_PREFERENCES,
  normalizeCreativePreferences,
  normalizeOrchestrationPreferences
} from '../creative'
import type { RunAgentRequest } from '../types'

describe('orchestration preferences mode', () => {
  it('defaults the shared orchestration profile to multi-agent mode', () => {
    expect(DEFAULT_ORCHESTRATION_PREFERENCES.mode).toBe('multi')
    expect(normalizeOrchestrationPreferences(undefined).mode).toBe('multi')
  })

  it('preserves an explicit single-agent mode', () => {
    expect(normalizeOrchestrationPreferences({ mode: 'single' }).mode).toBe('single')
  })

  it('preserves an explicit multi-agent mode', () => {
    expect(normalizeOrchestrationPreferences({ mode: 'multi' }).mode).toBe('multi')
  })

  it('falls back to multi-agent mode for an invalid mode without changing old fields', () => {
    expect(normalizeOrchestrationPreferences({
      mode: 'invalid',
      enabled: true,
      subagentsEnabled: true,
      enabledStageIds: ['plan', 'write'],
      modelByStage: { write: { providerId: 'provider-1', model: 'writer' } },
      maxCalls: 7,
      maxEstimatedTokens: 48000
    })).toEqual({
      mode: 'multi',
      enabled: true,
      subagentsEnabled: true,
      enabledStageIds: ['plan', 'write'],
      modelByStage: { write: { providerId: 'provider-1', model: 'writer' } },
      maxCalls: 7,
      maxEstimatedTokens: 48000
    })
  })

  it('keeps old persisted profiles readable when mode is absent', () => {
    expect(normalizeOrchestrationPreferences({
      enabled: false,
      subagentsEnabled: false,
      enabledStageIds: ['plan'],
      modelByStage: {},
      maxCalls: 3,
      maxEstimatedTokens: 12000
    })).toMatchObject({
      mode: 'multi',
      enabledStageIds: ['plan'],
      modelByStage: {},
      maxCalls: 3,
      maxEstimatedTokens: 12000
    })
  })

  it('uses creativePreferences.orchestration.mode as the only run mode source', () => {
    const request = {
      sessionId: 'session-1',
      message: '继续',
      providerId: 'provider-1',
      model: 'model-1',
      creative: normalizeCreativePreferences({
        mode: 'orchestration',
        orchestration: { mode: 'single', enabled: true, subagentsEnabled: false, enabledStageIds: ['write'], modelByStage: {} }
      })
    } satisfies RunAgentRequest

    expect(request.creative?.orchestration?.mode).toBe('single')
    expect(request).not.toHaveProperty('orchestrationMode')

    // @ts-expect-error orchestrationMode was removed; creative preferences own this mode.
    const duplicateMode: RunAgentRequest = { ...request, orchestrationMode: 'single' }
    expect(duplicateMode).toHaveProperty('orchestrationMode', 'single')
  })
})
