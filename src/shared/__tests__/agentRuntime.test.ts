import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../types'
import {
  ClientRunIdRegistry,
  adaptLegacyAgentEvent,
  validateRuntimeEvent,
  validateRunEventEnvelope
} from '../agentRuntime'
import { normalizeCreativePreferences } from '../creative'
import { normalizePlatformCapabilities } from '../platformCapabilities'

describe('agent runtime contract', () => {
  it('defaults missing creative preferences to basic mode without orchestration', () => {
    expect(normalizeCreativePreferences(undefined)).toMatchObject({
      mode: 'basic',
      orchestrationEnabled: false,
      subagentsEnabled: false,
      intensity: 'standard',
      selectedSkillIds: [],
      selectedRuleSetIds: []
    })
  })

  it('rejects unknown runtime event schema versions and event types', () => {
    expect(() => validateRunEventEnvelope({
      schemaVersion: 2,
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'basic',
      seq: 1,
      at: Date.now(),
      event: { type: 'run-start' }
    })).toThrow(/schemaVersion|版本/)

    expect(() => validateRunEventEnvelope({
      schemaVersion: 1,
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'basic',
      seq: 1,
      at: Date.now(),
      event: { type: 'not-a-runtime-event' }
    })).toThrow(/event|事件/)
  })

  it('validates structured question, skill candidate, and waiting-user events by stable identity', () => {
    expect(validateRuntimeEvent({ type: 'agent-question', payload: { questionId: 'question-1' } })).toEqual({
      type: 'agent-question',
      payload: { questionId: 'question-1' }
    })
    expect(validateRuntimeEvent({ type: 'skill-candidate', payload: { candidateId: 'candidate-1' } })).toEqual({
      type: 'skill-candidate',
      payload: { candidateId: 'candidate-1' }
    })
    expect(validateRuntimeEvent({ type: 'waiting-user', payload: { questionId: 'question-1' } })).toEqual({
      type: 'waiting-user',
      payload: { questionId: 'question-1' }
    })

    expect(() => validateRuntimeEvent({ type: 'agent-question', payload: {} })).toThrow('questionId')
    expect(() => validateRuntimeEvent({ type: 'skill-candidate', payload: {} })).toThrow('candidateId')
    expect(() => validateRuntimeEvent({ type: 'waiting-user', payload: {} })).toThrow(/questionId|candidateId/)
  })

  it('adapts a structured legacy agent-question event at the compatibility boundary', () => {
    const question = {
      questionId: 'question-1',
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'planner',
      title: '选择',
      description: '请选择',
      fields: [{ id: 'choice', label: '选项', type: 'single' as const, options: [{ id: 'a', label: 'A' }] }]
    }
    const envelope = adaptLegacyAgentEvent({
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'planner',
      seq: 1,
      event: { type: 'agent-question', question }
    })

    expect(envelope.event).toEqual({
      type: 'agent-question',
      payload: { questionId: 'question-1', question }
    })
    expect(validateRunEventEnvelope(envelope)).toEqual(envelope)
  })
  it('maps a legacy event exactly once at the compatibility boundary', () => {
    const legacy: AgentEvent = { type: 'text-delta', messageId: 'm', delta: '你好' }
    const envelope = adaptLegacyAgentEvent({
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'basic',
      seq: 1,
      event: legacy
    })

    expect(envelope.event).toEqual({ type: 'text-delta', messageId: 'm', delta: '你好' })
    expect(validateRunEventEnvelope(envelope)).toEqual(envelope)
  })

  it('returns the existing run for an identical client id and rejects changed input', () => {
    const registry = new ClientRunIdRegistry()
    const first = registry.claim({ workspaceId: 'w', clientRunId: 'client-1', requestHash: 'hash-a', runId: 'run-1' })
    const duplicate = registry.claim({ workspaceId: 'w', clientRunId: 'client-1', requestHash: 'hash-a', runId: 'run-2' })

    expect(first).toEqual({ created: true, runId: 'run-1' })
    expect(duplicate).toEqual({ created: false, runId: 'run-1' })
    expect(() => registry.claim({ workspaceId: 'w', clientRunId: 'client-1', requestHash: 'hash-b', runId: 'run-3' })).toThrow(/幂等|内容|changed/i)
  })

  it('normalizes capabilities conservatively when a remote peer omits fields', () => {
    expect(normalizePlatformCapabilities({ protocolVersion: 1 })).toMatchObject({
      protocolVersion: 1,
      skills: false,
      rules: false,
      orchestration: false,
      subagents: false,
      eventRecovery: false,
      budgets: false,
      orientation: 'none'
    })
  })
})
