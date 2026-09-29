import { expect, it } from 'vitest'
import { CoreAgentService } from '../agentLoop'
import { MemoryFileStore } from '../../storage/fileStore'
import { MemoryStore } from '../../memory/memoryStore'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { initializeWorkspace } from '../../workspace/workspaceService'

it('injects enabled Markdown memory into basic runs and omits it after disabling', async () => {
  const project = new MemoryFileStore()
  const global = new MemoryFileStore()
  await initializeWorkspace(project, '记忆测试')
  const memory = new MemoryStore(global, project)
  const initial = await memory.read('global')
  await memory.update('global', { baseRevision: initial.revision, enabled: true, content: '- 喜欢简洁回答\n' })
  const systems: string[] = []
  const service = new CoreAgentService({
    store: project,
    memoryStore: memory,
    sessions: new CoreSessionStore(project),
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => {
      systems.push(request.system)
      return { text: '好的', stopReason: 'stop' as const, toolCalls: [] }
    } }),
    emit: () => undefined
  })
  await service.run({ providerId: 'mock', model: 'mock', message: '你好', mode: 'normal' })
  expect(systems.some((system) => system.includes('喜欢简洁回答'))).toBe(true)
  const current = await memory.read('global')
  await memory.update('global', { baseRevision: current.revision, enabled: false })
  systems.length = 0
  await service.run({ providerId: 'mock', model: 'mock', message: '你好', mode: 'normal' })
  expect(systems.every((system) => !system.includes('喜欢简洁回答'))).toBe(true)
})

it('passes project memory to orchestration stages', async () => {
  const project = new MemoryFileStore()
  await initializeWorkspace(project, '编排记忆')
  const memory = new MemoryStore(new MemoryFileStore(), project)
  const initial = await memory.read('project')
  await memory.update('project', { baseRevision: initial.revision, enabled: true, content: '- 本项目只用第三人称\n' })
  const systems: string[] = []
  const service = new CoreAgentService({
    store: project,
    memoryStore: memory,
    sessions: new CoreSessionStore(project),
    settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'fake' }] }),
    getAdapter: () => ({ stream: async (_model, request) => {
      systems.push(request.system)
      return { text: '已规划', stopReason: 'stop' as const, toolCalls: [] }
    } }),
    emit: () => undefined
  })
  await service.run({ providerId: 'mock', model: 'mock', message: '规划一个章节', creative: {
    mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [], orchestration: { enabled: true, subagentsEnabled: false, enabledStageIds: ['plan'], modelByStage: {}, maxCalls: 1, maxEstimatedTokens: 1000000 }
  } })
  expect(systems.some((system) => system.includes('本项目只用第三人称'))).toBe(true)
})
