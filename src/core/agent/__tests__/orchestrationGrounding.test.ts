import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatSession, ToolCallData } from '../../../shared/types'
import type { LlmAdapter, StreamRequest, StreamResult } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { getNote, listNotes, saveCharacter } from '../../workspace/entityStore'
import { GlobalSkillLibrary } from '../../skills/globalSkillLibrary'
import { CoreAgentService } from '../agentLoop'

const providerId = 'orchestration-test-provider'
const stageIds = ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'] as const

function orchestrationPreferences() {
  return {
    mode: 'orchestration' as const,
    orchestrationEnabled: true,
    subagentsEnabled: false,
    intensity: 'standard' as const,
    selectedSkillIds: [],
    selectedRuleSetIds: [],
    orchestration: {
      enabled: true,
      subagentsEnabled: false,
      enabledStageIds: [...stageIds],
      modelByStage: {},
      maxCalls: 24,
      maxEstimatedTokens: 100_000
    }
  }
}

async function createStore(): Promise<MemoryFileStore> {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '编排事实读取测试')
  return store
}

function text(value: string): StreamResult {
  return { text: value, toolCalls: [], stopReason: 'stop' }
}

function nativeCall(id: string, name: string, args: Record<string, unknown>): StreamResult {
  const toolCall: ToolCallData = { id, name, argsJson: JSON.stringify(args) }
  return { text: '', toolCalls: [toolCall], stopReason: 'tool_calls' }
}

async function loadSession(store: MemoryFileStore, id: string): Promise<ChatSession> {
  const session = await new CoreSessionStore(store).load(id)
  if (!session) throw new Error('会话未落盘')
  return session
}

describe('orchestration grounding', () => {
  it('executes a native read call and feeds its tool result into the next stage request', async () => {
    const store = await createStore()
    const requests: StreamRequest[] = []
    const executedToolNames: string[] = []
    const events: AgentEvent[] = []
    const adapter: LlmAdapter = {
      stream: async (_model, request) => {
        requests.push(structuredClone(request))
        if (requests.length === 1) return nativeCall('read-characters-1', 'list_characters', {})
        return text(`stage-result-${requests.length}`)
      }
    }
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => adapter,
      emit: (_sessionId, event) => events.push(event),
      executeTool: async (name) => {
        executedToolNames.push(name)
        return { kind: 'result', ok: true, text: '[{"id":"char_a","name":"甲"}]', preview: '已读取人物目录' }
      }
    })

    const result = await service.run({
      message: '继续第二十章',
      providerId,
      model: 'mock-model',
      creative: orchestrationPreferences()
    })
    const session = await loadSession(store, result.sessionId)

    expect(executedToolNames).toContain('list_characters')
    expect(requests.some((request) => request.messages.some((message) => message.role === 'tool'))).toBe(true)
    expect(session.messages.some((message) => message.role === 'tool' && message.toolName === 'list_characters')).toBe(true)
    expect(events.some((event) => event.type === 'tool-done' && event.ok)).toBe(true)
  })

  it('does not complete an orchestration run when the model only emits a textual tool marker', async () => {
    const store = await createStore()
    const adapter: LlmAdapter = {
      stream: async () => text('<tool_call><function=list_characters></function></tool_call>')
    }
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => adapter,
      emit: () => undefined,
      executeTool: async () => ({ kind: 'result', ok: true, text: 'should not execute', preview: 'should not execute' })
    })

    const result = await service.run({
      message: '继续第二十章',
      providerId,
      model: 'mock-model',
      creative: orchestrationPreferences()
    })
    const session = await loadSession(store, result.sessionId)
    const run = session.orchestrationRuns?.at(-1)

    expect(run?.status).not.toBe('completed')
    expect(run?.stages.some((stage) => stage.status === 'failed')).toBe(true)
  })

  it('gives read-only child agents real project tools and feeds their receipts back before they report', async () => {
    const store = await createStore()
    const requests: StreamRequest[] = []
    const executedToolNames: string[] = []
    const adapter: LlmAdapter = {
      stream: async (_model, request) => {
        requests.push(structuredClone(request))
        const childRequest = request.messages.some((message) => (message.text ?? '').includes('只读子智能体'))
        if (childRequest && !request.messages.some((message) => message.role === 'tool')) return nativeCall(`child-read-${requests.length}`, 'list_characters', {})
        return text('核对完成：资料已读取，未发现问题。')
      }
    }
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => adapter,
      emit: () => undefined,
      executeTool: async (name) => {
        executedToolNames.push(name)
        return { kind: 'result', ok: true, text: '[{"id":"char_a","name":"甲"}]', preview: '已读取人物目录' }
      }
    })

    await service.run({
      message: '优化第二十三到第二十四章',
      providerId,
      model: 'mock-model',
      creative: { ...orchestrationPreferences(), subagentsEnabled: true, orchestration: { ...orchestrationPreferences().orchestration, subagentsEnabled: true, enabledStageIds: ['plan'] } }
    })

    expect(requests.filter((request) => request.messages.some((message) => (message.text ?? '').includes('只读子智能体'))).every((request) => request.tools.some((tool) => tool.name === 'list_characters'))).toBe(true)
    expect(executedToolNames).toContain('list_characters')
    expect(requests.some((request) => request.messages.some((message) => message.role === 'tool'))).toBe(true)
  })

  it('gives every child the current project sources and skill tools, then forwards findings to the next stage', async () => {
    const store = await createStore()
    await saveCharacter(store, { name: '甲', summary: '主角，负责推进主线。' })
    const skillLibrary = new GlobalSkillLibrary(store)
    const requests: StreamRequest[] = []
    const adapter: LlmAdapter = {
      stream: async (_model, request) => {
        requests.push(structuredClone(request))
        const firstText = request.messages[0]?.text ?? ''
        if (firstText.includes('只读子智能体')) {
          if (!request.messages.some((message) => message.role === 'tool')) return nativeCall(`child-doc-${requests.length}`, 'list_project_docs', {})
          return text('只读发现：项目文档与人物资料一致。')
        }
        return text('阶段结果')
      }
    }
    const service = new CoreAgentService({
      store,
      workspaceId: 'workspace',
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => adapter,
      globalSkillLibrary: skillLibrary,
      emit: () => undefined,
      executeTool: async () => ({ kind: 'result', ok: true, text: '[]', preview: '已读取项目资料' })
    })

    await service.run({
      message: '检查人物与项目文档',
      providerId,
      model: 'mock-model',
      creative: { ...orchestrationPreferences(), subagentsEnabled: true, orchestration: { ...orchestrationPreferences().orchestration, subagentsEnabled: true, enabledStageIds: ['plan'] } }
    })

    const childRequest = requests.find((request) => (request.messages[0]?.text ?? '').includes('只读子智能体'))
    expect(childRequest?.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_characters', 'list_project_docs', 'read_project_doc', 'list_skills']))
    expect(childRequest?.messages[0]?.text).toContain('characters/index')
    const planRequest = requests.find((request) => request.system.includes('【当前角色】plan'))
    expect(planRequest?.messages.some((message) => (message.text ?? '').includes('只读发现：项目文档与人物资料一致。'))).toBe(true)
  })

  it('lets the write stage act as the executor and apply an approved mutation', async () => {
    const store = await createStore()
    const adapter: LlmAdapter = {
      stream: async (_model, request) => {
        const isWriteStage = request.system.includes('【当前角色】write')
        if (isWriteStage && !request.messages.some((message) => message.role === 'tool')) {
          return nativeCall('write-note-1', 'save_note', { note: { title: '执行结果', content: '已由执行者写入' } })
        }
        return text('阶段完成。')
      }
    }
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => adapter,
      emit: () => undefined
    })

    await service.run({
      message: '把结论写入便签',
      providerId,
      model: 'mock-model',
      approvalPolicy: 'auto',
      creative: { ...orchestrationPreferences(), orchestration: { ...orchestrationPreferences().orchestration, enabledStageIds: ['plan', 'setting', 'prompt', 'write'] } }
    })

    const notes = await listNotes(store)
    const saved = notes.find((note) => note.title === '执行结果')
    expect(saved && (await getNote(store, saved.id))?.content).toBe('已由执行者写入')
  })

  it('hands the polished candidate back to the user instead of the pre-polish draft', async () => {
    const store = await createStore()
    const adapter: LlmAdapter = {
      stream: async (_model, request) => {
        const role = request.system.match(/【当前角色】([^\n]+)/u)?.[1] ?? 'unknown'
        return text(role === 'write' ? '草稿候选' : role === 'polish' ? '润色候选' : `${role} 完成`)
      }
    }
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => adapter,
      emit: () => undefined
    })

    const result = await service.run({
      message: '润色一章',
      providerId,
      model: 'mock-model',
      creative: { ...orchestrationPreferences(), orchestration: { ...orchestrationPreferences().orchestration, enabledStageIds: ['plan', 'setting', 'prompt', 'write', 'polish', 'review'] } }
    })
    const session = await loadSession(store, result.sessionId)

    expect(session.messages.at(-1)?.text).toBe('润色候选')
  })

  it('persists a resumable budget pause with the current stage instead of losing the orchestration run', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.invalid', apiKey: 'test-key' }] }),
      getAdapter: () => ({ stream: async () => text('阶段结果') }),
      emit: (_sessionId, event) => events.push(event)
    })

    const result = await service.run({
      message: '检查并写作',
      providerId,
      model: 'mock-model',
      creative: { ...orchestrationPreferences(), orchestration: { ...orchestrationPreferences().orchestration, enabledStageIds: ['plan', 'setting'], maxCalls: 1, maxEstimatedTokens: 100_000 } }
    })
    const session = await loadSession(store, result.sessionId)
    const run = session.orchestrationRuns?.at(-1)

    expect(run).toMatchObject({ status: 'paused_budget', currentStage: 'setting' })
    expect(run?.error).toContain('预算')
    expect(events.some((event) => event.type === 'run-paused' && event.reason === 'budget')).toBe(true)
    expect(events.some((event) => event.type === 'done')).toBe(true)
  })
})
