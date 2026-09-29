import { expect, it, vi } from 'vitest'
import type { AgentEvent, ChatSession } from '../../../shared/types'
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
import { RuleStore } from '../../rules/ruleStore'
import { GlobalSkillLibrary } from '../../skills/globalSkillLibrary'

type SkillActivityEvent = Extract<AgentEvent, { type: 'skill-activity' }>
type RuleActivityEvent = Extract<AgentEvent, { type: 'rule-activity' }>

function skillActivityEvents(events: AgentEvent[]): SkillActivityEvent[] {
  return events.filter((event): event is SkillActivityEvent => event.type === 'skill-activity')
}

function ruleActivityEvents(events: AgentEvent[]): RuleActivityEvent[] {
  return events.filter((event): event is RuleActivityEvent => event.type === 'rule-activity')
}

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
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: ['natural-dialogue'], selectedRuleSetIds: [], orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: ['plan'], modelByStage: {}, maxCalls: 1, maxEstimatedTokens: 1000000 }
  } })
  expect(calls).toBe(1)
  expect(stages).toContain('plan')
  expect(result.runId).toBeTruthy()
  expect(prompts.some((prompt) => prompt.includes(builtinPackages[1].files[0].content))).toBe(true)
})

it('uses the provider and model assigned to an orchestration stage', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-stage-model-selection')
  const sessions = new CoreSessionStore(store)
  const calls: Array<{ baseUrl: string; model: string; temperature?: number }> = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [
      { id: 'default', protocol: 'openai', baseUrl: 'https://default.invalid/v1', apiKey: 'default-key' },
      { id: 'writer', protocol: 'openai', baseUrl: 'https://writer.invalid/v1', apiKey: 'writer-key' }
    ], agentGeneration: { agentTemperature: 70, proseAlternativesEnabled: false } }),
    getAdapter: (_protocol, baseUrl) => ({ stream: async (model, request) => {
      calls.push({ baseUrl, model, temperature: request.params?.temperature })
      return { text: 'draft', stopReason: 'stop' as const, toolCalls: [] }
    } }),
    emit: () => undefined
  })

  await service.run({ providerId: 'default', model: 'default-model', message: 'write', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: ['plan', 'setting', 'prompt', 'write'], modelByStage: { write: { providerId: 'writer', model: 'writer-model' } }, maxCalls: 4, maxEstimatedTokens: 100000 }
  } })

  expect(calls).toEqual([
    { baseUrl: 'https://default.invalid/v1', model: 'default-model', temperature: 0.5 },
    { baseUrl: 'https://default.invalid/v1', model: 'default-model', temperature: 0.5 },
    { baseUrl: 'https://default.invalid/v1', model: 'default-model', temperature: 0.5 },
    { baseUrl: 'https://writer.invalid/v1', model: 'writer-model', temperature: 0.5 }
  ])
})

it('keeps every orchestration stage on the session model in single-agent mode', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-single-orchestration')
  const sessions = new CoreSessionStore(store)
  const calls: string[] = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [
      { id: 'default', protocol: 'openai', baseUrl: 'https://default.invalid/v1', apiKey: 'default-key' },
      { id: 'other', protocol: 'openai', baseUrl: 'https://other.invalid/v1', apiKey: 'other-key' }
    ] }),
    getAdapter: (_protocol, baseUrl) => ({ stream: async (model) => { calls.push(`${baseUrl}:${model}`); return { text: 'ok', stopReason: 'stop' as const, toolCalls: [] } } }),
    emit: () => undefined
  })

  await service.run({ providerId: 'default', model: 'session-model', message: '写作', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: { mode: 'single', enabled: true, subagentsEnabled: false, enabledStageIds: ['plan', 'setting', 'prompt', 'write'], modelByStage: { write: { providerId: 'other', model: 'other-model' } }, maxCalls: 4, maxEstimatedTokens: 100000 }
  } })

  expect(calls).toEqual([
    'https://default.invalid/v1:session-model',
    'https://default.invalid/v1:session-model',
    'https://default.invalid/v1:session-model',
    'https://default.invalid/v1:session-model'
  ])
})

it('runs bounded read-only subagents through the shared budget before orchestration stages', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-orchestration-subagents')
  const sessions = new CoreSessionStore(store)
  const calls: Array<{ baseUrl: string; model: string; task: string; temperature?: number }> = []
  const usage: Array<{ purpose?: string; model?: string; parentAgentId?: string }> = []
  const events: AgentEvent[] = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [
      { id: 'default', protocol: 'openai', baseUrl: 'https://default.invalid/v1', apiKey: 'default-key' },
      { id: 'reviewer', protocol: 'openai', baseUrl: 'https://reviewer.invalid/v1', apiKey: 'reviewer-key' },
      { id: 'stylist', protocol: 'openai', baseUrl: 'https://stylist.invalid/v1', apiKey: 'stylist-key' }
    ], agentGeneration: { agentTemperature: 65, proseAlternativesEnabled: false } }),
    getAdapter: (_protocol, baseUrl) => ({ stream: async (model, request, _key, handlers) => {
      const task = request.messages[0]?.text ?? ''
      calls.push({ baseUrl, model, task, temperature: request.params?.temperature })
      if (task.includes('连续性')) handlers.onText('连续性建议')
      if (task.includes('文风')) handlers.onText('文风建议')
      return {
        text: task.includes('当前阶段：plan') ? '计划产物' : '子任务建议',
        stopReason: 'stop' as const,
        toolCalls: [],
        usage: { promptTokens: 12, completionTokens: 4, cachedTokens: 0, cacheWriteTokens: 0 }
      }
    } }),
    emit: (_sid, event) => events.push(event),
    onUsage: (record) => usage.push(record)
  })

  await service.run({ providerId: 'default', model: 'default-model', message: '写第一章', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: true, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: {
      enabled: true,
      subagentsEnabled: true,
      enabledStageIds: ['plan'],
      modelByStage: {
        review: { providerId: 'reviewer', model: 'reviewer-model' },
        'anti-ai': { providerId: 'stylist', model: 'stylist-model' }
      },
      maxCalls: 3,
      maxEstimatedTokens: 100000
    }
  } })

  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ baseUrl: 'https://reviewer.invalid/v1', model: 'reviewer-model' }),
    expect.objectContaining({ baseUrl: 'https://stylist.invalid/v1', model: 'stylist-model' }),
    expect.objectContaining({ baseUrl: 'https://default.invalid/v1', model: 'default-model', task: expect.stringContaining('当前阶段：plan') })
  ]))
  expect(usage.filter((record) => record.purpose === 'child')).toEqual(expect.arrayContaining([
    expect.objectContaining({ model: 'reviewer-model', parentAgentId: 'orchestration' }),
    expect.objectContaining({ model: 'stylist-model', parentAgentId: 'orchestration' })
  ]))
  expect(events).toContainEqual({ type: 'stage-start', stageId: 'subagent:continuity' })
  expect(events).toContainEqual({ type: 'stage-complete', stageId: 'subagent:style' })
  expect(calls.map((call) => call.temperature)).toEqual([0.55, 0.55, 0.55])
})

it('cancels a subagent run before it can start another child or orchestration stage', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-orchestration-subagent-abort')
  const sessions = new CoreSessionStore(store)
  let sessionId = ''
  let calls = 0
  let service!: CoreAgentService
  service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, _request, _key, handlers) => {
      calls += 1
      handlers.onText('已收到部分子任务建议')
      service.abort(sessionId)
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    } }),
    emit: (sid) => { sessionId = sid }
  })

  await service.run({ providerId: 'mock', model: 'audit-model', message: '写第一章', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: true, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: { enabled: true, subagentsEnabled: true, enabledStageIds: ['plan'], modelByStage: {}, maxCalls: 3, maxEstimatedTokens: 100000 }
  } })

  expect(calls).toBe(1)
  const saved = await sessions.load(sessionId)
  expect(saved?.messages.at(-1)?.text).toBe('已中止本次生成。')
})

it('persists every orchestration artifact and sends the real session context to stages', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-orchestration-artifacts')
  const sessions = new CoreSessionStore(store)
  const existing = await sessions.create()
  existing.messages = [{ id: 'history', role: 'assistant', text: 'HISTORY_SENTINEL' }]
  await sessions.save(existing)
  const stageIds = ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'] as const
  const prompts: string[] = []
  let calls = 0
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => {
      prompts.push(request.messages[0]?.text ?? '')
      const stageId = stageIds[calls++]
      return { text: `OUTPUT_${stageId}`, stopReason: 'stop' as const, toolCalls: [] }
    } }),
    emit: () => undefined
  })

  const result = await service.run({ sessionId: existing.id, providerId: 'mock', model: 'audit-model', message: 'write', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: [...stageIds], modelByStage: {}, maxCalls: 7, maxEstimatedTokens: 100000 }
  } })
  const saved = await sessions.load(result.sessionId)
  const persisted = (saved as ChatSession & { orchestrationRuns?: Array<{ artifacts: Array<{ stageId: string; text?: string }>; stages: Array<{ status: string }>; status: string }> })?.orchestrationRuns?.at(-1)

  expect(prompts.some((prompt) => prompt.includes('HISTORY_SENTINEL'))).toBe(true)
  expect(persisted?.status).toBe('completed')
  expect(persisted?.artifacts.map((artifact) => artifact.stageId)).toEqual(stageIds)
  expect(persisted?.artifacts.map((artifact) => artifact.text)).toEqual(stageIds.map((stageId) => `OUTPUT_${stageId}`))
})

it('keeps an orchestration stage partial when the user aborts it', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-orchestration-abort')
  const sessions = new CoreSessionStore(store)
  let sessionId = ''
  let service!: CoreAgentService
  service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request, _key, handlers) => {
      if (!request.messages[0]?.text?.includes('当前阶段：write')) return { text: 'PLAN', stopReason: 'stop' as const, toolCalls: [] }
      handlers.onText('WRITE_PARTIAL')
      service.abort(sessionId)
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    } }),
    emit: (sid) => { sessionId = sid }
  })

  const result = await service.run({ providerId: 'mock', model: 'audit-model', message: 'write', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: ['plan', 'setting', 'prompt', 'write'], modelByStage: {}, maxCalls: 4, maxEstimatedTokens: 100000 }
  } })
  const saved = await sessions.load(result.sessionId)
  const persisted = (saved as ChatSession & { orchestrationRuns?: Array<{ status: string; artifacts: Array<{ stageId: string; text?: string }> }> })?.orchestrationRuns?.at(-1)

  expect(persisted?.status).toBe('cancelled')
  expect(persisted?.artifacts.some((artifact) => artifact.stageId === 'plan')).toBe(true)
  expect(persisted?.artifacts.find((artifact) => artifact.stageId === 'write')?.text).toBe('WRITE_PARTIAL')
})

it('applies stage-scoped workspace rules only to the matching orchestration stage', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-orchestration-rules')
  await new RuleStore(store).save([{ source: 'workspace', rules: [{ id: 'review-only', kind: 'guidance', target: 'review', key: 'freeText', value: 'REVIEW_ONLY_SENTINEL', severity: 'prefer', enabled: true }] }])
  const sessions = new CoreSessionStore(store)
  const prompts = new Map<string, string>()
  const stages = ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'] as const
  let calls = 0
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => {
      prompts.set(stages[calls], request.system)
      calls += 1
      return { text: 'ok', stopReason: 'stop' as const, toolCalls: [] }
    } }),
    emit: () => undefined
  })

  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: [...stages], modelByStage: {}, maxCalls: 7, maxEstimatedTokens: 100000 }
  } })

  expect(prompts.get('review')).toContain('REVIEW_ONLY_SENTINEL')
  expect([...prompts.entries()].filter(([stage]) => stage !== 'review').every(([, prompt]) => !prompt.includes('REVIEW_ONLY_SENTINEL'))).toBe(true)
})

it('does not turn an explicitly empty stage selection into all seven model calls', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-empty-orchestration')
  const sessions = new CoreSessionStore(store)
  let calls = 0
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async () => { calls += 1; return { text: 'unexpected', stopReason: 'stop' as const, toolCalls: [] } } }),
    emit: () => undefined
  })

  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
    orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: [], modelByStage: {}, maxCalls: 7, maxEstimatedTokens: 100000 }
  } })

  expect(calls).toBe(0)
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

it('emits rule inspection and application evidence before a basic run', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-rule-evidence')
  await new RuleStore(store).save([{ source: 'workspace', rules: [{ id: 'voice', kind: 'guidance', target: 'all', key: 'voice', value: '克制', severity: 'prefer', enabled: true }] }])
  const sessions = new CoreSessionStore(store)
  const events: AgentEvent[] = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async () => ({ text: 'answer', stopReason: 'stop' as const, toolCalls: [] }) }),
    emit: (_sid, event) => events.push(event)
  })
  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write' })
  expect(ruleActivityEvents(events).map((event) => event.activity.status)).toEqual(['checked', 'matched', 'applied'])
  expect(ruleActivityEvents(events).find((event) => event.activity.status === 'applied')?.activity.rules[0]).toMatchObject({ id: 'voice', source: 'workspace' })
})

it('preflights enabled skills and stage rules for ordinary Chinese writing requests', async () => {
  const store = new MemoryFileStore()
  const globalStore = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-basic-skill-preflight')
  const library = new GlobalSkillLibrary(globalStore)
  const writeSkill = structuredClone(builtinPackages[1])
  writeSkill.manifest.id = 'test.write-style'
  writeSkill.manifest.name = '写作阶段指导'
  writeSkill.manifest.skills[0].id = 'write-style'
  writeSkill.manifest.skills[0].path = 'skills/write-style/SKILL.md'
  writeSkill.manifest.ruleSets = []
  writeSkill.files = [{ path: 'skills/write-style/SKILL.md', content: '---\nid: write-style\nname: 写作阶段指导\nstages: [write]\n---\nENABLED_WRITE_SKILL_GUIDANCE' }]
  const disabledSkill = structuredClone(writeSkill)
  disabledSkill.manifest.id = 'test.disabled-style'
  disabledSkill.manifest.name = '已停用技能'
  disabledSkill.manifest.skills[0].id = 'disabled-style'
  disabledSkill.manifest.skills[0].path = 'skills/disabled-style/SKILL.md'
  disabledSkill.files[0].path = 'skills/disabled-style/SKILL.md'
  disabledSkill.files[0].content = '---\nid: disabled-style\nname: 已停用技能\nstages: [write]\n---\nDISABLED_SKILL_GUIDANCE'
  await library.install(writeSkill, true)
  await library.install(disabledSkill, false)
  await new RuleStore(store).save([{ source: 'workspace', rules: [
    { id: 'write-voice', kind: 'guidance', target: 'write', key: 'voice', value: 'WRITE_STAGE_RULE_GUIDANCE', severity: 'must', enabled: true },
    { id: 'review-only', kind: 'guidance', target: 'review', key: 'tone', value: 'REVIEW_ONLY_RULE', severity: 'prefer', enabled: true }
  ] }])
  const sessions = new CoreSessionStore(store)
  let prompt = ''
  const events: AgentEvent[] = []
  const service = new CoreAgentService({
    store, sessions, globalSkillLibrary: library,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => { prompt = request.system; return { text: 'answer', stopReason: 'stop' as const, toolCalls: [] } } }),
    emit: (_sid, event) => events.push(event)
  })

  await service.run({ providerId: 'mock', model: 'audit-model', message: '写第一章' })

  expect(prompt).toContain('ENABLED_WRITE_SKILL_GUIDANCE')
  expect(prompt).toContain('WRITE_STAGE_RULE_GUIDANCE')
  expect(prompt).not.toContain('DISABLED_SKILL_GUIDANCE')
  expect(prompt).not.toContain('REVIEW_ONLY_RULE')
  expect(skillActivityEvents(events).map((event) => event.activity.status)).toEqual(['checked', 'matched', 'loaded', 'applied'])
  expect(skillActivityEvents(events).find((event) => event.activity.status === 'applied')?.activity.skills.map((skill) => skill.skillId)).toContain('write-style')
  expect(skillActivityEvents(events).find((event) => event.activity.status === 'applied')?.activity.skills.map((skill) => skill.skillId)).not.toContain('disabled-style')
  expect(ruleActivityEvents(events).map((event) => event.activity.status)).toEqual(['checked', 'matched', 'applied'])
  const appliedRuleIds = ruleActivityEvents(events).find((event) => event.activity.status === 'applied')?.activity.rules.map((rule) => rule.id) ?? []
  expect(appliedRuleIds).toContain('write-voice')
  expect(appliedRuleIds).not.toContain('review-only')
})

it('scopes the system prompt to the current project and migrates the legacy value only when absent', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-project-prompt')
  await store.writeText('docs/system-prompt.md', 'PROJECT_ONLY_PROMPT')
  const sessions = new CoreSessionStore(store)
  let prompt = ''
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }], customPrompt: 'LEGACY_GLOBAL_PROMPT' }),
    getAdapter: () => ({ stream: async (_model, request) => { prompt = request.system; return { text: 'answer', stopReason: 'stop' as const, toolCalls: [] } } }),
    emit: () => undefined
  })
  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write' })
  expect(prompt).toContain('PROJECT_ONLY_PROMPT')
  expect(prompt).not.toContain('LEGACY_GLOBAL_PROMPT')

  const migratedStore = new MemoryFileStore()
  await initializeWorkspace(migratedStore, 'audit-project-prompt-migration')
  const migratedSessions = new CoreSessionStore(migratedStore)
  const migrated = new CoreAgentService({
    store: migratedStore,
    sessions: migratedSessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }], customPrompt: 'LEGACY_GLOBAL_PROMPT' }),
    getAdapter: () => ({ stream: async () => ({ text: 'answer', stopReason: 'stop' as const, toolCalls: [] }) }),
    emit: () => undefined
  })
  await migrated.run({ providerId: 'mock', model: 'audit-model', message: 'write' })
  expect(await migratedStore.readText('docs/system-prompt.md')).toBe('LEGACY_GLOBAL_PROMPT')
})

it('consumes the legacy global prompt once so it cannot leak into a second empty project', async () => {
  let legacyPrompt: string | undefined = 'LEGACY_GLOBAL_PROMPT'
  const prompts: string[] = []
  const runProject = async (name: string): Promise<MemoryFileStore> => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, name)
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }], customPrompt: legacyPrompt }),
      consumeLegacyCustomPrompt: async (migrate) => {
        const prompt = legacyPrompt?.trim()
        if (!prompt) return undefined
        await migrate(prompt)
        legacyPrompt = undefined
        return prompt
      },
      getAdapter: () => ({ stream: async (_model, request) => { prompts.push(request.system); return { text: 'answer', stopReason: 'stop' as const, toolCalls: [] } } }),
      emit: () => undefined
    })
    await service.run({ providerId: 'mock', model: 'audit-model', message: 'write' })
    return store
  }

  const firstProject = await runProject('legacy-prompt-first-project')
  const secondProject = await runProject('legacy-prompt-second-project')
  expect(await firstProject.readText('docs/system-prompt.md')).toBe('LEGACY_GLOBAL_PROMPT')
  expect(await secondProject.readText('docs/system-prompt.md')).toBeNull()
  expect(prompts[0]).toContain('LEGACY_GLOBAL_PROMPT')
  expect(prompts[1]).not.toContain('LEGACY_GLOBAL_PROMPT')
})

it('uses every enabled content package when chat no longer carries per-message skill selections', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-default-enabled-skills')
  const sessions = new CoreSessionStore(store)
  let prompt = ''
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => { prompt = request.system; return { text: 'answer', stopReason: 'stop' as const, toolCalls: [] } } }),
    emit: () => undefined
  })

  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write', creative: { mode: 'basic', orchestrationEnabled: false, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [] } })

  expect(prompt).toContain(builtinPackages[0].files[0].content)
  expect(prompt).toContain('重复总结')
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

it('emits a readable save_chapter body preview while its tool arguments are still incomplete', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, 'audit-tool-body-preview')
  const sessions = new CoreSessionStore(store)
  const events: AgentEvent[] = []
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, _request, _key, handlers) => {
      handlers.onToolCallStart?.('tool-1', 'save_chapter', 0)
      handlers.onToolArgsDelta?.('tool-1', '{"chapter":{"content":"正文第一段', 0)
      handlers.onToolArgsDelta?.('tool-1', '继续"}}', 0)
      handlers.onToolCallComplete?.('tool-1', 'save_chapter', '{"chapter":{"content":"正文第一段继续"}}', 0)
      return { text: '', stopReason: 'tool_calls' as const, toolCalls: [{ id: 'tool-1', name: 'save_chapter', argsJson: '{"chapter":{"content":"正文第一段继续"}}' }] }
    } }),
    emit: (_sid, event) => events.push(event),
    executeTool: async () => ({ kind: 'result' as const, ok: true, text: '{}', preview: 'ok' })
  })

  await service.run({ providerId: 'mock', model: 'audit-model', message: 'write' })

  expect(events).toContainEqual({ type: 'tool-preview', callId: 'tool-1', preview: '正文第一段' })
  expect(events).toContainEqual({ type: 'tool-preview', callId: 'tool-1', preview: '正文第一段继续' })
})

void vi
