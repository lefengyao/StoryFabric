import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatSession } from '../../../shared/types'
import { normalizeCreativePreferences } from '../../../shared/creative'
import type { LlmAdapterFactory } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

describe('session mode regression', () => {
  it('hands a previous orchestration run to normal mode without replaying stage tool calls', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '编排切换回归')
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    const runId = 'run_previous'
    const artifact = {
      id: 'artifact_plan', runId, stageId: 'plan', agentId: 'plan', version: 1,
      kind: 'plan', status: 'candidate', inputArtifactIds: [], sourceRevisions: { source: 'r1' },
      text: '先检查人物关系，再续写第七章。', contentHash: 'hash', createdAt: 1
    }
    session.creativePreferences = normalizeCreativePreferences({ mode: 'orchestration', orchestrationEnabled: true })
    session.orchestrationRuns = [{ runId, status: 'completed', sourceRevision: 'r1', originalText: '', stages: [{ stageId: 'plan', status: 'completed', artifactId: artifact.id }], artifacts: [artifact], overlay: {}, businessText: '', updatedAt: 1 }]
    session.messages = [
      { id: 'earlier-user', role: 'user', text: '请规划第七章' },
      { id: `${runId}_plan_assistant_1`, role: 'assistant', toolCalls: [{ id: 'old-tool', name: 'list_characters', argsJson: '{}' }], thinkingBlocks: [{ type: 'thinking', thinking: 'old model', signature: 'old-signature' }] },
      { id: `${runId}_plan_tool_2`, role: 'tool', toolCallId: 'old-tool', toolName: 'list_characters', text: '旧模型的工具结果' },
      { id: 'final-answer', role: 'assistant', text: '编排已经完成。' }
    ]
    await sessions.save(session)

    const requests: Array<{ system: string; messages: ChatSession['messages']; tools: Array<{ name: string }> }> = []
    let round = 0
    const service = new CoreAgentService({
      store, sessions,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: () => ({ stream: async (_model, request) => {
        requests.push({ system: request.system, messages: structuredClone(request.messages), tools: request.tools })
        round += 1
        if (round === 1) return { text: '', toolCalls: [{ id: 'read-plan', name: 'read_orchestration_artifact', argsJson: JSON.stringify({ runId, artifactId: artifact.id }) }], stopReason: 'tool_calls' as const }
        return { text: '已阅读计划并继续处理。', toolCalls: [], stopReason: 'stop' as const }
      } }),
      emit: () => undefined
    })

    await service.run({ sessionId: session.id, mode: 'normal', providerId: 'mock', model: 'mock', message: '根据之前的编排计划继续' })

    expect(requests[0].system).toContain('本会话编排交接')
    expect(requests[0].tools.map((tool) => tool.name)).toContain('read_orchestration_artifact')
    expect(requests[0].messages.some((item) => item.id.startsWith(`${runId}_plan_`))).toBe(false)
    expect(requests[0].messages.some((item) => item.id === 'final-answer')).toBe(true)
    expect(requests[1].messages.find((item) => item.toolCallId === 'read-plan')?.text).toContain(artifact.text)
    expect((await sessions.load(session.id))?.creativePreferences?.orchestrationEnabled).toBe(false)
  })

  it('lets a later orchestration member read an earlier run in the same session', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '编排成员交接')
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    session.orchestrationRuns = [{
      runId: 'prior-run', status: 'completed', sourceRevision: 'r1', originalText: '',
      stages: [{ stageId: 'plan', status: 'completed', artifactId: 'prior-plan' }],
      artifacts: [{ id: 'prior-plan', runId: 'prior-run', stageId: 'plan', agentId: 'plan', version: 1, kind: 'plan', status: 'candidate', inputArtifactIds: [], sourceRevisions: { source: 'r1' }, text: '上一次规划要保留人物关系', contentHash: 'hash', createdAt: 1 }],
      overlay: {}, businessText: '', updatedAt: 1
    }]
    await sessions.save(session)

    let round = 0
    const requests: Array<{ tools: string[]; messages: ChatSession['messages'] }> = []
    const service = new CoreAgentService({
      store, sessions,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: () => ({ stream: async (_model, request) => {
        requests.push({ tools: request.tools.map((tool) => tool.name), messages: structuredClone(request.messages) })
        round += 1
        if (round === 1) return { text: '', toolCalls: [{ id: 'prior-read', name: 'read_orchestration_artifact', argsJson: '{"runId":"prior-run","artifactId":"prior-plan"}' }], stopReason: 'tool_calls' as const }
        if (round === 2) return { text: '', toolCalls: [{ id: 'project-read', name: 'list_characters', argsJson: '{}' }], stopReason: 'tool_calls' as const }
        return { text: '据已有规划及人物资料重新制定计划。', toolCalls: [], stopReason: 'stop' as const }
      } }),
      emit: () => undefined
    })

    await service.run({ sessionId: session.id, mode: 'orchestration', providerId: 'mock', model: 'mock', message: '继续规划', creative: normalizeCreativePreferences({ mode: 'orchestration', orchestrationEnabled: true, orchestration: { enabled: true, enabledStageIds: ['plan'], modelByStage: {} } }) })

    expect(requests[0].tools).toContain('read_orchestration_artifact')
    expect(requests[1].messages.find((item) => item.toolCallId === 'prior-read')?.text).toContain('上一次规划要保留人物关系')
  })

  it('normal mode overrides a persisted orchestration snapshot for this run', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '普通模式回归')
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    session.creativePreferences = normalizeCreativePreferences({
      mode: 'orchestration',
      orchestrationEnabled: true,
      orchestration: { enabled: true, enabledStageIds: ['plan'], modelByStage: {} }
    })
    await sessions.save(session)

    const events: AgentEvent[] = []
    const factory: LlmAdapterFactory = () => ({
      stream: async () => ({ text: '简单修改已完成', toolCalls: [], stopReason: 'stop' as const })
    })
    const service = new CoreAgentService({
      store,
      sessions,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: factory,
      emit: (_sessionId, event) => events.push(event)
    })

    await service.run({ sessionId: session.id, mode: 'normal', providerId: 'mock', model: 'mock', message: '一句简单修改' })

    expect(events.some((event) => event.type === 'stage-start')).toBe(false)
    const saved = await sessions.load(session.id)
    expect(saved?.messages.at(-1)?.text).toBe('简单修改已完成')
  })

  it('shows a visible failure when an orchestration stage returns no text after the retry', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '编排空响应恢复')
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    await sessions.save(session)
    let calls = 0
    const service = new CoreAgentService({
      store,
      sessions,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: () => ({ stream: async () => { calls += 1; return { text: '', toolCalls: [], stopReason: 'stop' as const } } }),
      emit: () => undefined
    })

    await service.run({
      sessionId: session.id,
      mode: 'orchestration',
      providerId: 'mock',
      model: 'mock',
      message: '制定计划',
      creative: normalizeCreativePreferences({ mode: 'orchestration', orchestrationEnabled: true, orchestration: { enabled: true, enabledStageIds: ['plan'], modelByStage: {} } })
    })

    const saved = await sessions.load(session.id)
    expect(calls).toBe(2)
    expect(saved?.messages.some((message) => message.role === 'assistant' && !message.text?.trim())).toBe(false)
    expect(saved?.messages.at(-1)?.text).toContain('编排失败')
    expect(saved?.messages.at(-1)?.text).toContain('空响应')
    expect(saved?.orchestrationRuns?.at(-1)?.status).toBe('failed')
  })

  it('runs chapter polish candidates with read-only tools and blocks model write calls', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '章节候选只读回归')
    const sessions = new CoreSessionStore(store)
    const events: AgentEvent[] = []
    const toolNames: string[][] = []
    let executeToolCalls = 0
    const factory: LlmAdapterFactory = () => ({
      stream: async (_model, request) => {
        toolNames.push(request.tools.map((tool) => tool.name))
        if (toolNames.length === 1) return {
          text: '',
          toolCalls: [{ id: 'unsafe-save', name: 'save_chapter', argsJson: '{}' }],
          stopReason: 'tool_calls' as const
        }
        return { text: '候选已给出', toolCalls: [], stopReason: 'stop' as const }
      }
    })
    const service = new CoreAgentService({
      store,
      sessions,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: factory,
      emit: (_sessionId, event) => events.push(event),
      executeTool: async () => { executeToolCalls += 1; throw new Error('write must not execute') }
    })

    await service.run({
      mode: 'normal', providerId: 'mock', model: 'mock', message: '润色章节',
      attachments: [{ kind: 'chapter', id: 'chapter-1', label: '第一章', purpose: 'chapter-polish-candidate' }]
    })

    expect(toolNames[0]).toContain('get_chapter')
    expect(toolNames[0]).not.toContain('save_chapter')
    expect(executeToolCalls).toBe(0)
    expect(events.some((event) => event.type === 'pending-change')).toBe(false)
    expect(events.some((event) => event.type === 'tool-done' && event.callId === 'unsafe-save' && !event.ok)).toBe(true)
    expect(events).toContainEqual({ type: 'stage-start', stageId: 'polish' })
    expect(events).toContainEqual({ type: 'stage-complete', stageId: 'polish' })
  })

  it('exposes the de-AI chapter agent as a distinct live stage', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '去 AI 智能体可见性')
    const events: AgentEvent[] = []
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: () => ({ stream: async () => ({ text: '去 AI 候选', toolCalls: [], stopReason: 'stop' as const }) }),
      emit: (_sessionId, event) => events.push(event)
    })

    await service.run({
      mode: 'normal', providerId: 'mock', model: 'mock', message: '去 AI 风格',
      attachments: [{ kind: 'chapter', id: 'chapter-1', label: '第一章', purpose: 'chapter-de-ai-candidate' }]
    })

    expect(events).toContainEqual({ type: 'stage-start', stageId: 'anti-ai' })
    expect(events).toContainEqual({ type: 'stage-complete', stageId: 'anti-ai' })
  })

  it('rejects a second run for the same session before loading it again', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '并发运行保护')
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    await sessions.save(session)
    let release!: () => void
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => { started = resolve })
    const factory: LlmAdapterFactory = () => ({
      stream: async () => {
        started()
        await new Promise<void>((resolve) => { release = resolve })
        return { text: '完成', toolCalls: [], stopReason: 'stop' as const }
      }
    })
    const service = new CoreAgentService({
      store,
      sessions,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: factory,
      emit: () => undefined
    })
    const first = service.run({ sessionId: session.id, providerId: 'mock', model: 'mock', message: '第一个任务' })
    await startedPromise
    await expect(service.run({ sessionId: session.id, providerId: 'mock', model: 'mock', message: '第二个任务' })).rejects.toThrow('已有运行中的任务')
    release()
    await first
  })
})
