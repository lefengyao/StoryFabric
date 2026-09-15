import { expect, it, vi } from 'vitest'
import { CoreAgentService } from '../agentLoop'
import { runBasicPolish } from '../basicPolish'
import { contentRevision } from '../../workspace/resourceRevision'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { validateContentPackage } from '../../skills/packageValidator'
import { builtinPackages } from '../../skills/builtin'
import { PortableUsageStore } from '../../usage/portableUsageStore'
import { OrchestrationScheduler } from '../../orchestration/scheduler'
import { SubagentManager } from '../../orchestration/subagents'
import { useRunStore } from '../../../renderer/src/stores/runStore'
import { orchestrationStartEnabled } from '../../../renderer/src/components/chat/OrchestrationPanel'

it('keeps the orchestration action disabled until capabilities explicitly confirm support', () => {
  expect(orchestrationStartEnabled(undefined, false)).toBe(false)
  expect(orchestrationStartEnabled({ orchestration: false }, false)).toBe(false)
  expect(orchestrationStartEnabled({ orchestration: true }, false)).toBe(true)
})

it('routes orchestration through a budgeted stage runner and includes selected skill guidance', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-orchestration')
  const sessions = new CoreSessionStore(store)
  let calls = 0
  const stages: string[] = []
  const prompts: string[] = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request, _key, handlers) => {
      calls += 1
      prompts.push(request.system)
      if (calls === 1) return { text: '', stopReason: 'tool_calls' as const, toolCalls: [{ id: 'read-1', name: 'list_notes', argsJson: '{}' }] }
      handlers.onText('unexpected second call')
      return { text: 'unexpected second call', stopReason: 'stop' as const, toolCalls: [] }
    } }),
    emit: (_sid, event) => { if (event.type === 'stage-start') stages.push(event.stageId) }
  })

  const result = await service.run({ providerId: 'mock', model: 'audit-model', message: 'write a chapter', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: ['natural-dialogue'], selectedRuleSetIds: [], orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: [], modelByStage: {}, maxCalls: 1, maxEstimatedTokens: 1000 }
  } })
  expect(calls).toBe(1)
  expect(stages).toContain('plan')
  expect(result.runId).toBeTruthy()
  expect(prompts.some((prompt) => prompt.includes(builtinPackages[1].files[0].content))).toBe(true)
})

it('includes selected builtin skill guidance in a basic model request', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-basic-skill')
  const sessions = new CoreSessionStore(store)
  let prompt = ''
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => { prompt = request.system; return { text: 'answer', stopReason: 'stop' as const, toolCalls: [] } } }),
    emit: () => undefined
  })
  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write', creative: { mode: 'basic', orchestrationEnabled: false, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: ['natural-dialogue'], selectedRuleSetIds: [] } })
  expect(prompt).toContain(builtinPackages[1].files[0].content)
})

it('includes selected builtin rule content in a basic model request', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-basic-rule')
  const sessions = new CoreSessionStore(store)
  let prompt = ''
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => { prompt = request.system; return { text: 'answer', stopReason: 'stop' as const, toolCalls: [] } } }),
    emit: () => undefined
  })
  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write', creative: { mode: 'basic', orchestrationEnabled: false, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: ['natural-dialogue'] } })
  expect(prompt).toContain('对白解释已知事实')
})

it('attributes basic model calls to a run through the shared usage gateway', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-basic-budget')
  const sessions = new CoreSessionStore(store)
  const usage: unknown[] = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async () => ({ text: 'answer', stopReason: 'stop' as const, toolCalls: [], usage: { promptTokens: 4, completionTokens: 2, cachedTokens: 0, cacheWriteTokens: 0 } }) }),
    emit: () => undefined,
    onUsage: (record) => usage.push(record)
  })
  const result = await service.run({ providerId: 'mock', model: 'audit-model', message: 'write' })
  expect(usage).toEqual([expect.objectContaining({ runId: result.runId, purpose: 'basic', callId: expect.any(String), usageSource: 'actual' })])
})

it('persists streamed assistant text when a core agent run is aborted', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-abort')
  const sessions = new CoreSessionStore(store)
  let activeSessionId = ''
  const partial = '已经生成但尚未完成的正文'
  let service!: CoreAgentService
  service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, _request, _key, handlers) => {
      handlers.onText(partial)
      service.abort(activeSessionId)
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    } }),
    emit: (sessionId) => { activeSessionId = sessionId }
  })

  const result = await service.run({ providerId: 'mock', model: 'audit-model', message: 'write' })
  const saved = await sessions.load(result.sessionId)
  expect(saved?.messages.some((message) => message.text?.includes(partial))).toBe(true)
})

it('accepts the existing string content revision for basic polish', async () => {
  await expect(runBasicPolish({
    workspaceId: 'w', entityId: 'chapter-1', revision: contentRevision('original'), originalText: 'original', intensity: 'light', skills: [],
    call: async () => ({ text: 'polished' })
  })).resolves.toMatchObject({ baseRevision: contentRevision('original') })
})

it('rejects a malformed rule set instead of accepting arbitrary JSON', () => {
  const packageCopy = structuredClone(builtinPackages[0])
  packageCopy.files.find((file) => file.path.startsWith('rules/'))!.content = JSON.stringify({ schemaVersion: 999, rules: 'invalid' })
  expect(() => validateContentPackage(packageCopy)).toThrow(/规则|schema|版本/)
})

it('preserves independent rule targets when resolving the same key', async () => {
  const { resolveRules } = await import('../../rules/resolveRules')
  const common = { kind: 'constraint' as const, key: 'viewpoint', severity: 'must' as const, enabled: true }
  const result = resolveRules([{ source: 'workspace', rules: [
    { ...common, id: 'a', target: 'write', value: 'third-person' },
    { ...common, id: 'b', target: 'review', value: 'first-person' }
  ] }])
  expect(result.effective).toHaveLength(2)
  expect(result.conflicts).toHaveLength(0)
})

it('serializes concurrent portable usage appends without dropping records', async () => {
  const usageStore = new PortableUsageStore(new MemoryFileStore())
  const usage = { at: 0, providerId: 'mock', providerName: 'mock', model: 'mock', promptTokens: 10, completionTokens: 1, cachedTokens: 0, cacheWriteTokens: 0 }
  await Promise.all([usageStore.append({ ...usage, callId: 'a' }), usageStore.append({ ...usage, callId: 'b' })])
  expect(await usageStore.list()).toHaveLength(2)
})

it('does not execute dependent stages when the required plan is disabled', async () => {
  const calls: string[] = []
  const scheduler = new OrchestrationScheduler({ call: async ({ stageId }) => { calls.push(stageId); return { text: stageId } } })
  const result = await scheduler.run({ runId: 'r', workspaceId: 'w', sourceRevision: 1, goal: 'write', originalText: '', enabledStageIds: ['write', 'review'] })
  expect(calls).toEqual([])
  expect(result.stages.find((stage) => stage.stageId === 'write')?.status).toBe('stale')
})

it('executes delegated child tasks and exposes their structured result', async () => {
  const manager = new SubagentManager({ workspaceId: 'w', maxConcurrent: 1, runTask: async () => ({ text: 'checked' }) })
  const child = await manager.delegate({ task: 'review character', role: 'review', depth: 1, sourceRefs: [] })
  await manager.waitForIdle()
  expect(manager.list().find((item) => item.id === child.id)).toMatchObject({ status: 'completed', result: { text: 'checked' } })
})

it('propagates cancellation to a running delegated child task', async () => {
  let release!: () => void
  let signal: AbortSignal | undefined
  const manager = new SubagentManager({ workspaceId: 'w', maxConcurrent: 1, runTask: async (_input, childSignal) => {
    signal = childSignal
    await new Promise<void>((resolve) => { release = resolve })
    if (childSignal.aborted) throw new Error('cancelled')
    return { text: 'late result' }
  } })
  const child = await manager.delegate({ task: 'review', role: 'review', depth: 1, sourceRefs: [] })
  await Promise.resolve()
  manager.cancel(child.id)
  expect(signal?.aborted).toBe(true)
  release()
  await manager.waitForIdle()
  expect(manager.list().find((item) => item.id === child.id)?.status).toBe('cancelled')
})

it('forwards streamed tool argument deltas through the real agent event path', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-tool-preview')
  const sessions = new CoreSessionStore(store)
  const events: unknown[] = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, _request, _key, handlers) => {
      handlers.onToolCallStart?.('tool-1', 'list_notes', 0)
      handlers.onToolArgsDelta?.('tool-1', '{"query":"', 0)
      handlers.onToolArgsDelta?.('tool-1', '伏笔"}', 0)
      handlers.onToolCallComplete?.('tool-1', 'list_notes', '{"query":"伏笔"}', 0)
      return { text: '', stopReason: 'tool_calls' as const, toolCalls: [{ id: 'tool-1', name: 'list_notes', argsJson: '{"query":"伏笔"}' }] }
    } }),
    emit: (_sid, event) => events.push(event),
    executeTool: async () => ({ kind: 'result' as const, ok: true, text: '[]', preview: '[]' })
  })
  await service.run({ providerId: 'mock', model: 'audit-model', message: 'inspect' })
  expect(events).toContainEqual({ type: 'tool-args-delta', callId: 'tool-1', delta: '{"query":"' })
  expect(events).toContainEqual({ type: 'tool-args-delta', callId: 'tool-1', delta: '伏笔"}' })
})

it('rebuilds renderer partials from ordered events and keeps failed terminal state', () => {
  useRunStore.getState().clear()
  const emit = (seq: number, event: Parameters<ReturnType<typeof useRunStore.getState>['applyEvent']>[0]['event']) => useRunStore.getState().applyEvent({ schemaVersion: 1, workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'a', seq, at: 0, event })
  emit(2, { type: 'text-delta', messageId: 'm', delta: '乙' })
  emit(1, { type: 'text-delta', messageId: 'm', delta: '甲' })
  emit(3, { type: 'run-error' })
  emit(4, { type: 'run-done', payload: { status: 'failed' } })
  expect(useRunStore.getState().runs.r.partialByMessage.m).toBe('甲乙')
  expect(useRunStore.getState().runs.r.status).toBe('failed')
})

void vi
