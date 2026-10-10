import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../shared/types'
import type { LlmAdapterFactory } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

const providerId = 'goal-provider'

describe('goal mode integration', () => {
  it('plans, executes, validates and emits goal events in one run', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '目标测试')
    const events: AgentEvent[] = []
    const requests: Array<{ params?: { temperature?: number } }> = []
    let call = 0
    const factory: LlmAdapterFactory = () => ({
      stream: async (_model, request) => {
        requests.push(request)
        call += 1
        if (call === 1) return { text: '{"tasks":[{"id":"write","title":"写作","instructions":"写一段","acceptanceCriteria":["有正文"],"dependsOn":[]}]}' , stopReason: 'stop' as const, toolCalls: [] }
        if (call === 2) return { text: '正文已完成', stopReason: 'stop' as const, toolCalls: [] }
        return { text: '{"passed":true,"reason":"验收通过"}', stopReason: 'stop' as const, toolCalls: [] }
      }
    })
    const service = new CoreAgentService({
      store,
      workspaceId: 'w',
      sessions: new CoreSessionStore(store),
      settings: async () => ({
        providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'key' }],
        agentGeneration: { agentTemperature: 65, proseAlternativesEnabled: false }
      }),
      getAdapter: factory,
      emit: (_sessionId, event) => events.push(event)
    })
    const result = await service.run({ mode: 'goal', message: '完成章节', providerId, model: 'mock' })
    expect(result.goalId).toEqual(expect.any(String))
    expect(result.status).toBe('completed')
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['goal-plan', 'goal-task', 'goal-validation']))
    expect(requests).toHaveLength(3)
    expect(requests.map((request) => request.params?.temperature)).toEqual([0.55, 0.55, 0.55])
  })

  it('returns needs-attention when a shared budget is exhausted', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '预算测试')
    const factory: LlmAdapterFactory = () => ({
      stream: async () => ({ text: '{"tasks":[{"id":"write","title":"写作","instructions":"写一段","acceptanceCriteria":["有正文"],"dependsOn":[]}]}' , stopReason: 'stop' as const, toolCalls: [] })
    })
    const service = new CoreAgentService({
      store,
      workspaceId: 'w',
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'key' }] }),
      getAdapter: factory,
      emit: () => undefined
    })
    await expect(service.run({ mode: 'goal', message: '完成章节', providerId, model: 'mock', creative: { mode: 'basic', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [], orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: ['write'], modelByStage: {}, maxCalls: 2, maxEstimatedTokens: 100 } } })).resolves.toMatchObject({ status: 'needs-attention' })
  })
})
