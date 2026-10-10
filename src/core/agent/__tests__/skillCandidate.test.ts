import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../../shared/types'
import type { ContentPackage } from '../../skills/types'
import { GlobalSkillLibrary } from '../../skills/globalSkillLibrary'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

const candidatePackage: ContentPackage = {
  manifest: {
    schemaVersion: 1,
    id: 'candidate-pack',
    version: '1.0.0',
    name: '候选技能',
    description: '测试用候选技能',
    author: 'test',
    license: 'MIT',
    minAppVersion: '0.1.7',
    platforms: ['windows', 'web', 'android'],
    skills: [{ id: 'candidate-skill', path: 'skills/candidate/SKILL.md' }],
    ruleSets: []
  },
  files: [{ path: 'skills/candidate/SKILL.md', content: '---\nid: candidate-skill\nname: 候选技能\nstages: [plan]\n---\n用于验证候选安装必须经过用户确认。' }]
}

describe('skill candidate approval', () => {
  it('pauses an orchestration run and installs only after an explicit decision', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, 'candidate-approval')
    const sessions = new CoreSessionStore(store)
    const library = new GlobalSkillLibrary(store)
    const events: AgentEvent[] = []
    let calls = 0
    const service = new CoreAgentService({
      store,
      sessions,
      globalSkillLibrary: library,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://candidate.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => ({ stream: async () => {
        calls += 1
        if (calls === 1) return {
          text: '',
          stopReason: 'tool_calls' as const,
          toolCalls: [{ id: 'candidate-call', name: 'propose_skill_package', argsJson: JSON.stringify({ package: candidatePackage, reason: '当前任务缺少该类校对能力' }) }]
        }
        return { text: '候选技能已按决定处理。', stopReason: 'stop' as const, toolCalls: [] }
      } }),
      emit: (_sessionId, event) => events.push(event)
    })

    const running = service.run({
      providerId: 'mock',
      model: 'candidate-model',
      message: '先做规划',
      creative: {
        mode: 'orchestration',
        orchestrationEnabled: true,
        subagentsEnabled: false,
        intensity: 'standard',
        selectedSkillIds: [],
        selectedRuleSetIds: [],
        orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: ['plan'], modelByStage: {}, maxCalls: 2, maxEstimatedTokens: 100000 }
      }
    })

    await vi.waitFor(() => expect(events.filter((event) => event.type === 'skill-candidate')).toHaveLength(1))
    const candidateEvent = events.find((event): event is Extract<AgentEvent, { type: 'skill-candidate' }> => event.type === 'skill-candidate')
    if (!candidateEvent) throw new Error('未收到候选事件')
    expect(events).toContainEqual({ type: 'waiting-user', candidateId: candidateEvent.candidate.candidateId, reason: 'skill-candidate' })
    expect(await library.get(candidatePackage.manifest.id, candidatePackage.manifest.version)).toBeNull()

    await service.resolveSkillCandidate(candidateEvent.candidate.candidateId, 'install-enable')
    await running

    expect(await library.get(candidatePackage.manifest.id, candidatePackage.manifest.version)).toMatchObject({ enabled: true })
    expect((await sessions.load(candidateEvent.candidate.sessionId))?.skillCandidates?.at(-1)).toMatchObject({ candidateId: candidateEvent.candidate.candidateId, status: 'accepted' })
    expect(calls).toBe(2)
  })
})
