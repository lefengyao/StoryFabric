import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatSession } from '../../../shared/types'
import type { LlmAdapter } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

describe('request context evidence', () => {
  it('reports per-stage request context separately from session message count', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '上下文证据')
    const events: AgentEvent[] = []
    const adapter: LlmAdapter = { stream: async () => ({ text: '阶段产物', toolCalls: [], stopReason: 'stop' }) }
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: 'p', protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test' }] }),
      getAdapter: () => adapter,
      emit: (_sessionId, event) => events.push(event)
    })

    const result = await service.run({
      message: '继续第二十章',
      providerId: 'p',
      model: 'mock',
      creative: {
        mode: 'orchestration',
        orchestrationEnabled: true,
        subagentsEnabled: false,
        intensity: 'standard',
        selectedSkillIds: [],
        selectedRuleSetIds: [],
        orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'], modelByStage: {}, maxCalls: 24, maxEstimatedTokens: 100000 }
      }
    })
    const session = await new CoreSessionStore(store).load(result.sessionId) as ChatSession
    const run = session.orchestrationRuns?.at(-1)
    const contexts = events.filter((event): event is Extract<AgentEvent, { type: 'request-context' }> => event.type === 'request-context')

    expect(session.messages.filter((message) => message.role === 'user' || message.role === 'assistant')).toHaveLength(2)
    expect(contexts).toHaveLength(7)
    expect(contexts.every((event) => event.usage.estimatedInputTokens > 0 && event.usage.contextLimit > 0)).toBe(true)
    expect(run?.requestContexts).toHaveLength(7)
    expect(new Set(run?.requestContexts?.map((item) => item.requestId)).size).toBe(7)
  })
})
