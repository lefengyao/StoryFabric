import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatSession, ModelSettings, UsageRecord } from '../../../shared/types'
import type { LlmAdapter, LlmAdapterFactory, StreamRequest, StreamResult } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { deleteNote, findCharacter, listNotes, saveCharacter, saveNote } from '../../workspace/entityStore'
import { listTrash } from '../../workspace/trash'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'
import { searchProjectPage } from '../../retrieval/projectIndex'
import { SourceCatalog } from '../../inspiration/sourceCatalog'
import { documentReference } from '../../inspiration/documentReference'

const providerId = 'prov_openai'

/** 脚本化适配器：按顺序返回预置结果，记录每次请求，不触网。 */
function scriptedFactory(results: StreamResult[]): { factory: LlmAdapterFactory; requests: StreamRequest[] } {
  const queue = [...results]
  const requests: StreamRequest[] = []
  const adapter: LlmAdapter = {
    stream: async (_model, request) => {
      // core 按引用传入 session.messages，后续轮次会继续 push；这里与当时状态完全解耦（含嵌套 toolCalls）
      requests.push({ ...request, messages: structuredClone(request.messages), tools: [...request.tools] })
      const next = queue.shift()
      if (!next) throw new Error('脚本已耗尽：出现未预期的额外模型调用')
      return next
    }
  }
  return { factory: () => adapter, requests }
}

const text = (value: string): StreamResult => ({ text: value, toolCalls: [], stopReason: 'stop' })
const call = (id: string, name: string, args: Record<string, unknown>): StreamResult => ({
  text: '',
  toolCalls: [{ id, name, argsJson: JSON.stringify(args) }],
  stopReason: 'tool_calls'
})

async function createStore(): Promise<MemoryFileStore> {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '测试')
  return store
}

function makeService(
  store: MemoryFileStore,
  results: StreamResult[],
  events: AgentEvent[],
  usage: UsageRecord[] = [],
  modelSettings?: Record<string, ModelSettings>,
  workspaceId?: string,
  agentGeneration?: Partial<import('../../../shared/agentGeneration').AgentGenerationPreferences>
): { service: CoreAgentService; requests: StreamRequest[] } {
  const scripted = scriptedFactory(results)
  const service = new CoreAgentService({
    store,
    workspaceId,
    sessions: new CoreSessionStore(store),
    settings: async () => ({
      providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test', name: '模拟供应商', modelSettings }],
      agentGeneration: { agentTemperature: 70, proseAlternativesEnabled: false, ...agentGeneration }
    }),
    getAdapter: scripted.factory,
    emit: (_sid, event) => events.push(event),
    onUsage: (record) => usage.push(record)
  })
  return { service, requests: scripted.requests }
}

async function loadSession(store: MemoryFileStore, sessionId: string): Promise<ChatSession> {
  const session = await new CoreSessionStore(store).load(sessionId)
  if (!session) throw new Error('会话未落盘')
  return session
}

describe('CoreAgentService', () => {
  it('lets the inspiration agent retrieve the end of an indexed long attachment through read-only tools', async () => {
    const store = await createStore()
    const catalog = new SourceCatalog(store)
    const source = await catalog.importBytes({ name: 'long.txt', bytes: new TextEncoder().encode(`第一章\n${'甲'.repeat(510_000)}\n第二章\n末尾线索`) })
    const indexed = await catalog.extract(source.id)
    const document = await catalog.document(source.id)
    const section = document.sections.at(-1)!
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [
      call('dir', 'list_document_sections', { sourceId: source.id, limit: 2 }),
      call('search', 'search_document', { sourceId: source.id, query: '末尾线索', revision: document.revision }),
      call('read', 'read_document_section', { sourceId: source.id, sectionId: section.id, revision: document.revision }),
      text('已读取第二章中的末尾线索。')
    ], events)
    await service.run({ mode: 'inspiration', message: documentReference(indexed), providerId, model: 'mock-model' })
    expect(requests[0].tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_document_sections', 'search_document', 'read_document_section']))
    expect(requests[0].tools.some((tool) => tool.name === 'save_project_doc')).toBe(false)
    const messages = JSON.stringify(requests.at(-1)?.messages)
    expect(messages).toContain('末尾线索')
    expect(messages).not.toContain('甲'.repeat(10_000))
    expect(events.some((event) => event.type === 'error')).toBe(false)
  })

  it('only exposes and executes bundled webpage extraction when the selected search mode allows it', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const off = makeService(store, [text('未联网')], events)
    await off.service.run({ message: '读取网页', providerId, model: 'mock-model', webSearchMode: 'off' })
    expect(off.requests[0].tools.some((tool) => tool.name === 'web_extract')).toBe(false)

    const scripted = scriptedFactory([call('extract-1', 'web_extract', { url: 'https://example.com' }), text('已读取网页')])
    const webFetch = vi.fn(async (_input: unknown) => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify({ content: '# Example Domain' }) }] }
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test' }] }),
      getAdapter: scripted.factory,
      emit: (_sid, event) => events.push(event),
      webFetch: webFetch as typeof fetch
    })
    const { sessionId } = await service.run({ message: '读取网页', providerId, model: 'mock-model', webSearchMode: 'free' })
    const session = await loadSession(store, sessionId)
    expect(scripted.requests[0].tools.some((tool) => tool.name === 'web_extract')).toBe(true)
    expect(session.messages.find((item) => item.toolCallId === 'extract-1')?.text).toContain('# Example Domain')
    expect(webFetch).toHaveBeenCalledTimes(1)
  })

  it('does not finish after a placeholder that promises to verify workspace state', async () => {
    const store = await createStore()
    await saveNote(store, { title: '落盘状态', content: '正文已处理' })
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [
      text('我核实一下实际落盘状态，不凭记忆说。'),
      call('verify-1', 'list_notes', {}),
      text('已核实：正文已经处理。')
    ], events)

    const { sessionId } = await service.run({ message: '正文有做处理吗', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)

    expect(requests).toHaveLength(3)
    expect(session.messages.some((message) => message.role === 'tool' && message.toolCallId === 'verify-1')).toBe(true)
    expect(session.messages.at(-1)?.text).toBe('已核实：正文已经处理。')
  })

  it('retries one empty model response and does not persist a blank assistant message', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [text(''), text('空响应后已恢复。')], events)

    const { sessionId } = await service.run({ message: '继续检查', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)

    expect(requests).toHaveLength(2)
    expect(requests[1].system).toContain('空响应')
    expect(session.messages.filter((message) => message.role === 'assistant' && !message.text?.trim())).toHaveLength(0)
    expect(session.messages.at(-1)?.text).toBe('空响应后已恢复。')
  })

  it('surfaces an explicit recoverable message after two empty model responses', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [text(''), text('')], events)

    const { sessionId } = await service.run({ message: '继续检查', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)

    expect(requests).toHaveLength(2)
    expect(session.messages.filter((message) => message.role === 'assistant' && !message.text?.trim())).toHaveLength(0)
    expect(session.messages.at(-1)?.text).toContain('模型返回了空响应')
    expect(session.messages.at(-1)?.isError).toBe(true)
  })

  it('读工具自动执行并把结果回注给模型', async () => {
    const store = await createStore()
    await saveNote(store, { title: '林晚的设定', content: '主角' })
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [call('c1', 'list_notes', {}), text('工作区里有 1 条便签。')], events)

    const { sessionId } = await service.run({ message: '有哪些便签？', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)

    expect(session.messages.some((m) => m.role === 'tool' && m.text?.includes('林晚的设定'))).toBe(true)
    expect(session.messages.at(-1)?.text).toBe('工作区里有 1 条便签。')

    // 回注必须真的发生在「发给模型的下一轮请求」里，而不只是落盘到会话。
    expect(requests).toHaveLength(2)
    expect(requests[0].messages.some((m) => m.role === 'tool')).toBe(false)
    expect(requests[1].messages.some((m) => m.role === 'tool' && m.text?.includes('林晚的设定'))).toBe(true)
    expect(requests[1].tools.length).toBeGreaterThan(0)
    expect(requests[1].system).toContain('save_chapter')
    expect(session.messages.at(-1)?.runActivity?.tools).toEqual([{ name: 'list_notes', count: 1, failed: 0 }])
    expect(session.messages.at(-1)?.runActivity?.skills).toEqual([])
    expect(session.messages.at(-1)?.runActivity?.rules.some((rule) => rule.id === 'planning-first-order')).toBe(true)
  })

  it('keeps each completed reply activity separate across turns', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service } = makeService(store, [call('c1', 'list_notes', {}), text('第一轮完成'), text('第二轮完成')], events)
    const { sessionId } = await service.run({ message: '查看便签', providerId, model: 'mock-model' })
    await service.run({ sessionId, message: '再说一句', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)
    const replies = session.messages.filter((message) => message.role === 'assistant' && message.runActivity)
    expect(replies).toHaveLength(2)
    expect(replies[0].runActivity?.tools).toEqual([{ name: 'list_notes', count: 1, failed: 0 }])
    expect(replies[1].runActivity?.tools).toEqual([])
  })

  it('工具执行器抛错时仍为每个 assistant tool call 回注失败结果', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const scripted = scriptedFactory([call('save-1', 'save_chapter', {}), text('已报告保存失败。')])
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test' }] }),
      getAdapter: scripted.factory,
      emit: (_sid, event) => events.push(event),
      executeTool: async () => { throw new Error('保存时发生 I/O 错误') }
    })

    const result = await service.run({ message: '保存', providerId, model: 'mock-model' })
    const session = await loadSession(store, result.sessionId)
    const toolMessage = session.messages.find((message) => message.role === 'tool' && message.toolCallId === 'save-1')
    expect(toolMessage?.isError).toBe(true)
    expect(toolMessage?.text).toContain('保存时发生 I/O 错误')
    expect(scripted.requests).toHaveLength(2)
    expect(scripted.requests[1].messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'save-1', isError: true }))
    expect(session.messages.at(-1)?.text).toBe('已报告保存失败。')
  })

  it('连续重复调用相同工具时提前停止，而不是依赖十轮上限', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const repeated = call('c1', 'list_notes', {})
    const { service, requests } = makeService(store, [repeated, repeated, repeated, text('未执行')], events)

    const { sessionId } = await service.run({ message: '检查便签', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)

    expect(requests).toHaveLength(3)
    expect(session.messages.at(-1)?.text).toContain('连续 3 轮调用完全相同的工具和参数')
    expect(session.messages.at(-1)?.text).not.toContain('上限（10 轮）')
  })

  it('普通模式使用设置的连续工具调用轮次上限', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [
      call('c1', 'list_notes', {}),
      call('c2', 'list_characters', {}),
      text('不应继续请求')
    ], events, [], undefined, undefined, { maxToolRounds: 2 })

    const { sessionId } = await service.run({ message: '连续调用工具', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)

    expect(requests).toHaveLength(2)
    expect(session.messages.at(-1)?.text).toContain('连续工具调用已达上限（2 轮）')
  })

  it('普通模式可把轮次上限提高到默认值以上', async () => {
    const store = await createStore()
    const sessions = new CoreSessionStore(store)
    const existing = await sessions.create()
    existing.title = '长会话'
    existing.messages = Array.from({ length: 90 }, (_, index) => ({
      id: `old_${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `历史第 ${index} 条：${'需要保留的上下文'.repeat(24)}`
    }))
    await sessions.save(existing)

    const events: AgentEvent[] = []
    const maxToolRounds = 101
    const responses = [
      text('早期对话摘要第一段。'),
      text('早期对话摘要第二段。'),
      ...Array.from({ length: maxToolRounds }, (_, index) =>
        call(`c${index}`, 'get_chapter', { chapterId: 'missing-chapter', offset: index })
      )
    ]
    const { service, requests } = makeService(
      store,
      responses,
      events,
      [],
      { 'mock-model': { contextTokens: 5000, maxOutputTokens: 800 } },
      undefined,
      { maxToolRounds }
    )

    const { sessionId } = await service.run({
      sessionId: existing.id,
      message: '继续逐项读取',
      providerId,
      model: 'mock-model',
      mode: 'normal',
      creative: {
        mode: 'orchestration',
        orchestrationEnabled: true,
        subagentsEnabled: false,
        intensity: 'standard',
        selectedSkillIds: [],
        selectedRuleSetIds: [],
        orchestration: { mode: 'single', enabled: true, subagentsEnabled: false, enabledStageIds: ['write'], modelByStage: {}, maxCalls: 1, maxEstimatedTokens: 100000000 }
      }
    })
    const session = await loadSession(store, sessionId)

    expect(requests.filter((request) => request.tools.length === 0)).toHaveLength(2)
    expect(requests.filter((request) => request.tools.length > 0)).toHaveLength(maxToolRounds)
    expect(session.contextSummary).toContain('早期对话摘要第二段')
    expect(session.messages.at(-1)?.text).toContain('连续工具调用已达上限（101 轮）')
  })

  it('emits applied only after the write promise resolves', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const scripted = scriptedFactory([call('w1', 'save_note', { note: { title: '确认', content: '不应出现在事件中的正文' } }), text('完成')])
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test' }] }),
      getAdapter: scripted.factory,
      emit: (_sid, event) => events.push(event),
      executeTool: async (name, argsJson) => {
        if (name !== 'save_note') throw new Error(`unexpected tool: ${name}`)
        return {
          kind: 'pending',
          change: {
            id: 'chg_gate',
            toolName: name,
            entityKind: 'note',
            entityId: 'note_gate',
            title: '保存便签',
            beforeText: '',
            afterText: JSON.parse(argsJson).note.content
          },
          apply: async () => {
            await gate
            return { ok: true, text: '已写入' }
          }
        }
      }
    })

    const run = service.run({ message: '写一条', providerId, model: 'mock-model' })
    await vi.waitFor(() => expect(events.some((event) => event.type === 'pending-change')).toBe(true))
    service.confirmChange('chg_gate', true)
    await Promise.resolve()
    expect(events.some((event) => event.type === 'change-result')).toBe(false)
    release()
    await run
    const applied = events.find((event) => event.type === 'change-result' && event.status === 'applied')
    expect(applied).toMatchObject({ appliedChange: { entityKind: 'note', entityId: 'note_gate' } })
    expect(JSON.stringify(applied)).not.toContain('不应出现在事件中的正文')
    expect(events.some((event) => event.type === 'change-applied')).toBe(false)
  })

  it('runs a complete search-read-update-verify tool loop with a fake model', async () => {
    const store = await createStore()
    const character = await saveCharacter(store, { name: '旧名', content: `${'铺垫'.repeat(800)}旧名` })
    const events: AgentEvent[] = []
    let service: CoreAgentService
    const adapter: LlmAdapter = {
      stream: async (_model, request) => {
        const toolMessages = request.messages.filter((message) => message.role === 'tool')
        if (toolMessages.length === 0) return call('s1', 'search_project', { query: '旧名', limit: 20 })
        if (toolMessages.length === 1) {
          const page = JSON.parse(toolMessages[0].text ?? '{}') as { hits: Array<{ id: string }> }
          return call('c1', 'get_character', { characterId: page.hits[0].id })
        }
        if (toolMessages.length === 2) {
          const current = JSON.parse(toolMessages[1].text ?? '{}') as { id: string; revision: string; content: string }
          return call('w1', 'save_character', {
            character: { id: current.id, baseRevision: current.revision, name: '新名', content: current.content.replaceAll('旧名', '新名') }
          })
        }
        if (toolMessages.length === 3) return call('s2', 'search_project', { query: '旧名', limit: 100 })
        return text('已修改并复核。')
      }
    }
    service = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test' }] }),
      getAdapter: () => adapter,
      emit: (_sid, event) => {
        events.push(event)
        if (event.type === 'pending-change') queueMicrotask(() => service.confirmChange(event.change.id, true))
      }
    })

    await service.run({ message: '把旧名改为新名并复查', providerId, model: 'mock-model' })
    const oldNamePage = await searchProjectPage(store, { query: '旧名', limit: 100 })
    const newNamePage = await searchProjectPage(store, { query: '新名', limit: 100 })
    expect(oldNamePage.totalMatches).toBe(0)
    expect(newNamePage.totalMatches).toBeGreaterThan(0)
    expect((await findCharacter(store, { id: character.id }))?.content).toContain('新名')
    expect(events.some((event) => event.type === 'change-result' && event.status === 'applied')).toBe(true)
  })

  it('上下文接近上限时先压缩较早对话，再携带摘要继续请求', async () => {
    const store = await createStore()
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    session.title = '长会话'
    session.messages = Array.from({ length: 90 }, (_, index) => ({
      id: `old_${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `历史第 ${index} 条：${'需要保留的上下文'.repeat(24)}`
    }))
    await sessions.save(session)

    const events: AgentEvent[] = []
    const { service, requests } = makeService(
      store,
      [
        text('用户正在批量整理章节。'),
        text('用户正在批量整理章节，下一步需要继续处理第九章。'),
        text('继续完成第九章。')
      ],
      events,
      [],
      { 'mock-model': { contextTokens: 5000, maxOutputTokens: 800 } }
    )

    const result = await service.run({ sessionId: session.id, message: '继续处理', providerId, model: 'mock-model' })
    const saved = await loadSession(store, result.sessionId)

    expect(events.some((event) => event.type === 'context-compression-start')).toBe(true)
    expect(events.some((event) => event.type === 'context-compressed')).toBe(true)
    expect(saved.contextSummary).toContain('用户正在批量整理章节')
    expect(saved.contextSummaryThrough).toMatch(/^old_/)
    expect(requests).toHaveLength(3)
    expect(requests[0].tools).toHaveLength(0)
    expect(requests[1].tools).toHaveLength(0)
    expect(requests[2].system).toContain('较早对话的压缩摘要')
    expect(requests[2].messages.length).toBeLessThan(saved.messages.length)
    expect(requests.map((request) => request.params?.temperature)).toEqual([0.5, 0.5, 0.5])
  })

  it('按供应商的每模型设置注入请求参数', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [text('完成')], events, [], {
      'mock-model': { reasoning: 'high', maxOutputTokens: 4096 }
    })

    await service.run({ message: '你好', providerId, model: 'mock-model' })

    // 上下文未配置 → 取模型档案默认值（未知模型 128K）
    expect(requests[0].params).toEqual({ reasoning: 'high', contextTokens: 131072, maxOutputTokens: 4096, temperature: 0.5 })
  })

  it('没有每模型设置时用档案默认值', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [text('完成')], events)

    await service.run({ message: '你好', providerId, model: 'mock-model' })

    expect(requests[0].params).toEqual({ reasoning: 'off', contextTokens: 131072, maxOutputTokens: 8192, temperature: 0.5 })
  })

  it('maps the default product temperature into normal chat model params', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [text('完成')], events)

    await service.run({ message: '你好', providerId, model: 'mock-model' })

    expect(requests[0].params).toMatchObject({ temperature: 0.5 })
  })

  it('在 done 事件前持久化最终助手消息', async () => {
    const store = await createStore()
    const trace: string[] = []
    let doneEvent: AgentEvent | undefined
    const scripted = scriptedFactory([text('最终回答')])
    const sessions = new class extends CoreSessionStore {
      override async save(session: ChatSession): Promise<void> {
        trace.push(session.messages.some((message) => message.role === 'assistant' && message.text === '最终回答') ? 'save-assistant' : 'save')
        await super.save(session)
      }
    }(store)
    const service = new CoreAgentService({
      store,
      sessions,
      settings: async () => ({ providers: [{ id: providerId, protocol: 'openai' as const, baseUrl: 'https://mock.local/v1', apiKey: 'sk-test' }] }),
      getAdapter: scripted.factory,
      emit: (_sid, event) => {
        if (event.type === 'done') {
          doneEvent = event
          trace.push('done')
        }
      }
    })

    await service.run({ message: '你好', providerId, model: 'mock-model' })

    expect(trace.indexOf('save-assistant')).toBeGreaterThanOrEqual(0)
    expect(trace.indexOf('save-assistant')).toBeLessThan(trace.indexOf('done'))
    expect(doneEvent?.type === 'done' ? doneEvent.session?.messages.at(-1)?.text : undefined).toBe('最终回答')
  })

  it('每次模型调用后回报归一化用量', async () => {
    const store = await createStore()
    await saveNote(store, { title: '林晚的设定', content: '主角' })
    const events: AgentEvent[] = []
    const usage: UsageRecord[] = []
    const { service } = makeService(
      store,
      [
        { ...call('c1', 'list_notes', {}), usage: { promptTokens: 100, completionTokens: 10, cachedTokens: 40, cacheWriteTokens: 0 } },
        { ...text('工作区里有 1 条便签。'), usage: { promptTokens: 200, completionTokens: 20, cachedTokens: 0, cacheWriteTokens: 0 } }
      ],
      events,
      usage,
      undefined,
      'project-a'
    )

    await service.run({ message: '有哪些便签？', providerId, model: 'mock-model' })

    expect(usage).toHaveLength(2)
    expect(usage[0]).toMatchObject({
      workspaceId: 'project-a',
      providerId,
      providerName: '模拟供应商',
      model: 'mock-model',
      promptTokens: 100,
      completionTokens: 10,
      cachedTokens: 40,
      cacheWriteTokens: 0
    })
    expect(typeof usage[0].at).toBe('number')
    expect(usage[1]).toMatchObject({ promptTokens: 200, completionTokens: 20 })
  })

  it('模型未返回用量时不回报', async () => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const usage: UsageRecord[] = []
    const { service } = makeService(store, [text('完成')], events, usage)

    await service.run({ message: '你好', providerId, model: 'mock-model' })

    expect(usage).toEqual([])
  })

  it('delete_note 被拒绝后保留便签、回收站为空并回注拒绝消息', async () => {
    const store = await createStore()
    const note = await saveNote(store, { title: '待删除便签', content: '保留内容' })
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [call('c1', 'delete_note', { noteId: note.id }), text('好的，已保留这条便签。')], events)

    const runPromise = service.run({ message: '删除这条便签', providerId, model: 'mock-model' })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'pending-change')).toBe(true))
    const changeEvent = events.find((e) => e.type === 'pending-change')
    if (!changeEvent || changeEvent.type !== 'pending-change') throw new Error('未收到待确认变更事件')
    expect(changeEvent.change.title).toBe('删除便签：待删除便签')
    service.confirmChange(changeEvent.change.id, false)

    const { sessionId } = await runPromise
    expect((await listNotes(store)).some((item) => item.id === note.id)).toBe(true)
    expect(await listTrash(store)).toHaveLength(0)
    const session = await loadSession(store, sessionId)
    expect(session.messages.some((m) => m.role === 'tool' && m.text?.includes('拒绝'))).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[1].messages.some((m) => m.role === 'tool' && m.text?.includes('拒绝'))).toBe(true)
  })

  it('delete_note 被批准后移入回收站并回注成功消息', async () => {
    const store = await createStore()
    const note = await saveNote(store, { title: '批准删除便签', content: '待移入回收站' })
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [call('c1', 'delete_note', { noteId: ` ${note.id} ` }), text('已完成。')], events)

    const runPromise = service.run({ message: '确认删除这条便签', providerId, model: 'mock-model' })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'pending-change')).toBe(true))
    const changeEvent = events.find((e) => e.type === 'pending-change')
    if (!changeEvent || changeEvent.type !== 'pending-change') throw new Error('未收到待确认变更事件')
    service.confirmChange(changeEvent.change.id, true)

    const { sessionId } = await runPromise
    expect((await listNotes(store)).some((item) => item.id === note.id)).toBe(false)
    expect((await listTrash(store)).some((entry) => entry.id === note.id)).toBe(true)
    const session = await loadSession(store, sessionId)
    expect(session.messages.some((m) => m.role === 'tool' && m.text?.includes('已将便签「批准删除便签」移入回收站'))).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[1].messages.some((m) => m.role === 'tool' && m.text?.includes('移入回收站'))).toBe(true)
  })

  it('写入确认失败时回注失败结果并继续下一轮对话', async () => {
    const store = await createStore()
    const note = await saveNote(store, { title: '会冲突的便签', content: '原文' })
    await deleteNote(store, note.id)
    const trashId = note.id
    const events: AgentEvent[] = []
    const serviceWithEvents = makeService(store, [call('c1', 'restore_from_trash', { id: trashId }), text('已处理写入失败。')], events).service

    const runPromise = serviceWithEvents.run({ message: '恢复便签', providerId, model: 'mock-model' })
    await vi.waitFor(() => expect(events.some((event) => event.type === 'pending-change')).toBe(true))
    await saveNote(store, { id: note.id, title: note.title, content: '占位文件' })
    const pending = events.find((event) => event.type === 'pending-change')
    if (!pending || pending.type !== 'pending-change') throw new Error('未收到待确认变更')
    serviceWithEvents.confirmChange(pending.change.id, true)

    const { sessionId } = await runPromise
    const session = await loadSession(store, sessionId)
    expect(session.messages.at(-1)?.text).toBe('已处理写入失败。')
    expect(session.messages.some((message) => message.role === 'tool' && message.isError && message.text?.includes('写入失败'))).toBe(true)
  })

  it.each([
    ['缺失', null],
    ['空字符串', ''],
    ['纯空白', '   ']
  ])('delete_note 对%s noteId 拒绝且不产生待确认变更', async (_label, noteId) => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const { service, requests } = makeService(store, [call('c1', 'delete_note', noteId === null ? {} : { noteId }), text('参数无效。')], events)

    const { sessionId } = await service.run({ message: '删除便签', providerId, model: 'mock-model' })

    expect(events.some((e) => e.type === 'pending-change')).toBe(false)
    const session = await loadSession(store, sessionId)
    expect(session.messages.some((m) => m.role === 'tool' && m.isError && m.text?.includes('noteId'))).toBe(true)
    // 脚本只有两条结果：若循环多发了一次请求，这里会捕获到。
    expect(requests).toHaveLength(2)
  })
})
