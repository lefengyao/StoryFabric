import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatSession, UsageRecord } from '../../../shared/types'
import type { LlmAdapter, LlmAdapterFactory, StreamRequest, StreamResult } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listNotes, saveNote } from '../../workspace/entityStore'
import { listTrash } from '../../workspace/trash'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

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
  usage: UsageRecord[] = []
): { service: CoreAgentService; requests: StreamRequest[] } {
  const scripted = scriptedFactory(results)
  const service = new CoreAgentService({
    store,
    sessions: new CoreSessionStore(store),
    settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test', name: '模拟供应商' }] }),
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
      usage
    )

    await service.run({ message: '有哪些便签？', providerId, model: 'mock-model' })

    expect(usage).toHaveLength(2)
    expect(usage[0]).toMatchObject({
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
