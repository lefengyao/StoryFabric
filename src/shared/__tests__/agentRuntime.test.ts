import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../types'
import {
  ClientRunIdRegistry,
  adaptLegacyAgentEvent,
  validateRuntimeEvent,
  validateRunEventEnvelope
} from '../agentRuntime'
import { normalizeCreativePreferences, normalizeOrchestrationPreferences } from '../creative'
import { normalizePlatformCapabilities } from '../platformCapabilities'
import { RunEventLedger } from '../../core/agent/events'

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

  it('normalizes persisted orchestration preferences into a reusable settings profile', () => {
    expect(normalizeOrchestrationPreferences({
      enabled: true,
      subagentsEnabled: true,
      mode: 'multi',
      enabledStageIds: ['plan', 'write'],
      modelByStage: {
        write: { providerId: 'provider-1', model: 'writer-model' },
        invalid: { providerId: '', model: 'missing-provider' }
      },
      maxCalls: 12,
      maxEstimatedTokens: 48000
    })).toEqual({
      enabled: true,
      subagentsEnabled: true,
      mode: 'multi',
      enabledStageIds: ['plan', 'write'],
      modelByStage: { write: { providerId: 'provider-1', model: 'writer-model' } },
      maxCalls: 12,
      maxEstimatedTokens: 48000
    })
  })

  it('upgrades the old orchestration token default so a full seven-stage run is not cut off mid-pipeline', () => {
    expect(normalizeOrchestrationPreferences({ maxEstimatedTokens: 100000 }).maxEstimatedTokens).toBe(300000)
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

  it('rejects incomplete non-structured runtime events', () => {
    expect(() => validateRuntimeEvent({ type: 'text-delta' })).toThrow(/messageId|delta/)
    expect(() => validateRuntimeEvent({ type: 'stage-start' })).toThrow(/payload/)
  })

  it('enforces the same validator when events enter the runtime ledger', () => {
    const ledger = new RunEventLedger(() => 1)
    expect(() => ledger.append({ workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'a', event: { type: 'text-delta' } as never })).toThrow(/messageId|delta/)
    expect(ledger.append({ workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'a', event: { type: 'run-start' } })).toMatchObject({ seq: 1, event: { type: 'run-start' } })
  })

  it('keeps complete sessions out of replayable runtime events', () => {
    const session = { id: 's', messages: [{ id: 'm', text: 'x'.repeat(200_000) }] } as never
    const start = adaptLegacyAgentEvent({ workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'basic', seq: 1, event: { type: 'session', session } })
    const done = adaptLegacyAgentEvent({ workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'basic', seq: 2, event: { type: 'done', session } })

    expect(start.event).toEqual({ type: 'run-start' })
    expect(done.event).toEqual({ type: 'run-done' })
    expect(JSON.stringify(start).length).toBeLessThan(500)
    expect(JSON.stringify(done).length).toBeLessThan(500)
  })

  it('requires structured question and skill-candidate payloads beyond stable identity', () => {
    expect(() => validateRuntimeEvent({ type: 'agent-question', payload: { questionId: 'question-1' } })).toThrow(/问题|question|title|description|fields/)
    expect(() => validateRuntimeEvent({ type: 'skill-candidate', payload: { candidateId: 'candidate-1' } })).toThrow(/候选|candidate|package/)
    expect(validateRuntimeEvent({ type: 'waiting-user', payload: { questionId: 'question-1' } })).toEqual({
      type: 'waiting-user',
      payload: { questionId: 'question-1' }
    })
    expect(validateRuntimeEvent({ type: 'waiting-user', payload: { candidateId: 'candidate-1' } })).toEqual({
      type: 'waiting-user',
      payload: { candidateId: 'candidate-1' }
    })

    expect(() => validateRuntimeEvent({ type: 'agent-question', payload: {} })).toThrow('questionId')
    expect(() => validateRuntimeEvent({ type: 'skill-candidate', payload: {} })).toThrow('candidateId')
    expect(() => validateRuntimeEvent({ type: 'waiting-user', payload: {} })).toThrow(/questionId|candidateId/)
  })

  it('validates complete question and skill candidate payloads', () => {
    expect(() => validateRuntimeEvent({
      type: 'agent-question',
      payload: { questionId: 'question-1', question: { questionId: 'question-1' } }
    })).toThrow(/问题|runId|title|description|fields/)

    const candidate = {
      candidateId: 'candidate-1',
      runId: 'r',
      sessionId: 'session-1',
      agentId: 'skill-agent',
      reason: '需要更自然的对白规则',
      package: {
        manifest: {
          schemaVersion: 1,
          id: 'pkg-1',
          version: '1.0.0',
          name: '对白规则',
          description: '对白规则包',
          author: 'agent',
          license: 'MIT',
          minAppVersion: '0.1.0',
          platforms: ['windows'],
          skills: [],
          ruleSets: []
        },
        files: []
      }
    }
    expect(validateRuntimeEvent({ type: 'skill-candidate', payload: { candidateId: 'candidate-1', candidate } })).toMatchObject({ type: 'skill-candidate' })
    expect(() => validateRuntimeEvent({
      type: 'skill-candidate',
      payload: { candidateId: 'candidate-1', candidate: { ...candidate, package: { manifest: {}, files: [] } } }
    })).toThrow(/manifest|package/)
    expect(() => validateRuntimeEvent({
      type: 'skill-candidate',
      payload: {
        candidateId: 'candidate-1',
        candidate: {
          ...candidate,
          package: {
            ...candidate.package,
            manifest: { ...candidate.package.manifest, skills: [{ id: 'dialogue', path: 'skills/dialogue/SKILL.md' }] }
          }
        }
      }
    })).toThrow(/不存在|引用|file/)
  })

  it('requires exactly one waiting-user identity', () => {
    expect(() => validateRuntimeEvent({ type: 'waiting-user', payload: { questionId: 'q1', candidateId: 'c1' } })).toThrow(/只能|之一|questionId|candidateId/)
  })

  it('uses the same structured validation when adapting legacy events', () => {
    expect(() => adaptLegacyAgentEvent({
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'planner',
      seq: 1,
      event: { type: 'agent-question', question: { questionId: 'question-1' } as unknown as Extract<AgentEvent, { type: 'agent-question' }>['question'] }
    })).toThrow(/问题|title|description|fields/)

    expect(() => adaptLegacyAgentEvent({
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'skill-agent',
      seq: 1,
      event: { type: 'skill-candidate', candidate: { candidateId: 'candidate-1' } as unknown as Extract<AgentEvent, { type: 'skill-candidate' }>['candidate'] }
    })).toThrow(/候选|candidate|package/)
  })

  it('rejects structured events whose identity does not match the envelope', () => {
    expect(() => adaptLegacyAgentEvent({
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'planner',
      seq: 1,
      event: { type: 'agent-question', question: { questionId: 'question-1', runId: 'other-run', sessionId: 's', agentId: 'planner', title: '需要确认', description: '说明', fields: [{ id: 'choice', label: '选择', type: 'single', options: [{ id: 'a', label: 'A' }] }] } }
    })).toThrow(/身份|envelope|不匹配/)
    expect(() => adaptLegacyAgentEvent({
      workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'planner', stageId: 'write', seq: 1,
      event: { type: 'stage-start', stageId: 'plan' }
    })).toThrow(/stageId|阶段|不匹配/)
  })

  it('adapts a structured legacy agent-question event at the compatibility boundary', () => {
    const question = {
      questionId: 'question-1',
      runId: 'r',
      sessionId: 's',
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

  it('maps legacy change decisions to the canonical change-result payload', () => {
    const envelope = adaptLegacyAgentEvent({
      workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'writer', seq: 1,
      event: { type: 'change-applied', changeId: 'change-1', approved: true }
    })
    expect(envelope.event).toEqual({ type: 'change-result', payload: { changeId: 'change-1', status: 'applied', message: '变更已应用' } })
  })

  it('adapts rule activity as a validated runtime event', () => {
    const activity = { runId: 'r', agentId: 'basic', status: 'applied' as const, rules: [{ id: 'rule-1', source: 'workspace', target: 'all', key: 'voice', severity: 'prefer' as const, reason: '当前项目规则' }], conflicts: 0, overridden: 1 }
    const envelope = adaptLegacyAgentEvent({ workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'basic', seq: 1, event: { type: 'rule-activity', activity } })
    expect(envelope.event).toEqual({ type: 'rule-activity', payload: { activity } })
    expect(validateRunEventEnvelope(envelope)).toEqual(envelope)
  })

  it('keeps skill activity identity and rejects cross-run activity payloads', () => {
    const activity = {
      runId: 'r', stageId: 'write', agentId: 'write', status: 'applied' as const,
      skills: [{ libraryId: 'global', packageId: 'dialogue-pack', skillId: 'dialogue', version: '1.0.0', contentHash: 'hash', reason: '当前阶段适用' }]
    }
    const envelope = adaptLegacyAgentEvent({ workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'write', stageId: 'write', seq: 1, event: { type: 'skill-activity', activity } })
    expect(envelope.event).toEqual({ type: 'skill-activity', payload: { activity } })
    expect(validateRunEventEnvelope(envelope)).toEqual(envelope)
    expect(() => validateRunEventEnvelope({ ...envelope, runId: 'other' })).toThrow(/skill-activity.*身份/)
  })

  it('rejects rule activity whose stage identity differs from the envelope', () => {
    expect(() => validateRunEventEnvelope({
      schemaVersion: 1, workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'write', stageId: 'write', seq: 1, at: Date.now(),
      event: { type: 'rule-activity', payload: { activity: {
        runId: 'r', stageId: 'review', agentId: 'write', status: 'none', rules: [], conflicts: 0, overridden: 0
      } } }
    })).toThrow(/rule-activity.*身份/)
  })

  it('preserves the small affected-entity descriptor on an applied change result', () => {
    const envelope = adaptLegacyAgentEvent({
      workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'writer', seq: 1,
      event: {
        type: 'change-result',
        changeId: 'change-1',
        status: 'applied',
        message: '已保存章节',
        appliedChange: { entityKind: 'chapter', entityId: 'cha_1' }
      } as unknown as AgentEvent
    })

    expect(envelope.event).toEqual({
      type: 'change-result',
      payload: {
        changeId: 'change-1',
        status: 'applied',
        message: '已保存章节',
        appliedChange: { entityKind: 'chapter', entityId: 'cha_1' }
      }
    })
    expect(() => validateRuntimeEvent({
      type: 'change-result',
      payload: {
        changeId: 'change-1',
        status: 'applied',
        message: '已保存章节',
        appliedChange: { entityKind: 'chapter', entityId: '' }
      }
    })).toThrow(/entityId/)
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
