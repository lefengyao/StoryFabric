import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../../shared/types'
import type { LlmAdapterFactory } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

const providerId = 'approval-provider'

function toolCall(name: string) {
  return { text: '', stopReason: 'tool_calls' as const, toolCalls: [{ id: 'call-1', name, argsJson: '{}' }] }
}

function completion() {
  return { text: '完成', stopReason: 'stop' as const, toolCalls: [] }
}

async function createService(policy: 'strict' | 'delete-confirm' | 'auto', toolName: string, provided?: { store?: MemoryFileStore; sessions?: CoreSessionStore }) {
  const store = provided?.store ?? new MemoryFileStore()
  await initializeWorkspace(store, '审批测试')
  const sessions = provided?.sessions ?? new CoreSessionStore(store)
  const events: AgentEvent[] = []
  let applied = false
  const factory: LlmAdapterFactory = () => ({
    stream: async () => {
      if (events.filter((event) => event.type === 'tool-start').length === 0) return toolCall(toolName)
      return completion()
    }
  })
  const service = new CoreAgentService({
    store,
    sessions,
    settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test-key' }] }),
    getAdapter: factory,
    emit: (_sessionId, event) => events.push(event),
    executeTool: async (name) => ({
      kind: 'pending' as const,
      change: { id: 'change-1', toolName: name, entityKind: 'note' as const, entityId: 'note-1', title: '保存便签', beforeText: '', afterText: '内容' },
      apply: async () => { applied = true; return { ok: true, text: '已写入' } }
    })
  })
  const run = service.run({ message: '执行操作', providerId, model: 'mock', approvalPolicy: policy })
  return { service, run, events, sessions, get applied() { return applied } }
}

describe('agent approval integration', () => {
  it('strict waits for approval before applying a save tool', async () => {
    const fixture = await createService('strict', 'save_note')
    await vi.waitFor(() => expect(fixture.events.some((event) => event.type === 'pending-change')).toBe(true), { timeout: 1000 })
    const pending = fixture.events.find((event) => event.type === 'pending-change')
    expect(pending?.type).toBe('pending-change')
    if (pending?.type !== 'pending-change') throw new Error('未收到待审批变更')
    expect(pending.change.sessionId).toBeTruthy()
    const persisted = await fixture.sessions.load(pending.change.sessionId!)
    expect(persisted?.pendingChange).toMatchObject({ id: 'change-1', runId: pending.change.runId, sessionId: pending.change.sessionId })
    expect(fixture.applied).toBe(false)
    fixture.service.confirmChange('change-1', true, pending.change.sessionId)
    await fixture.run
    expect(fixture.applied).toBe(true)
    expect((await fixture.sessions.load(pending.change.sessionId!))?.pendingChange).toBeUndefined()
  })

  it('delete-confirm applies writes immediately but waits for every delete tool', async () => {
    const write = await createService('delete-confirm', 'save_note')
    await write.run
    expect(write.applied).toBe(true)
    expect(write.events.some((event) => event.type === 'pending-change')).toBe(false)

    const deletion = await createService('delete-confirm', 'delete_entity')
    await vi.waitFor(() => expect(deletion.events.some((event) => event.type === 'pending-change')).toBe(true), { timeout: 1000 })
    expect(deletion.applied).toBe(false)
    expect(deletion.events.some((event) => event.type === 'pending-change')).toBe(true)
    deletion.service.confirmChange('change-1', true)
    await deletion.run
    expect(deletion.applied).toBe(true)
  })

  it('auto applies a write without emitting pending-change', async () => {
    const fixture = await createService('auto', 'save_chapter')
    await fixture.run
    expect(fixture.applied).toBe(true)
    expect(fixture.events.some((event) => event.type === 'pending-change')).toBe(false)
  })

  it('announces strict approval before a slow pending-change persistence finishes', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '审批通知测试')
    const base = new CoreSessionStore(store)
    let releasePersistence!: () => void
    const persistenceReleased = new Promise<void>((resolve) => { releasePersistence = resolve })
    let pendingPersistenceStarted!: () => void
    const pendingPersistence = new Promise<void>((resolve) => { pendingPersistenceStarted = resolve })
    const delayedSessions = {
      create: base.create.bind(base),
      load: base.load.bind(base),
      list: base.list.bind(base),
      save: async (session: Parameters<CoreSessionStore['save']>[0]) => {
        if (session.pendingChange) {
          pendingPersistenceStarted()
          await persistenceReleased
        }
        return base.save(session)
      }
    } as unknown as CoreSessionStore
    const fixture = await createService('strict', 'save_note', { store, sessions: delayedSessions })
    const run = fixture.run

    await pendingPersistence
    expect(fixture.events.some((event) => event.type === 'pending-change')).toBe(true)

    releasePersistence()
    const pending = fixture.events.find((event) => event.type === 'pending-change')
    if (pending?.type !== 'pending-change') throw new Error('未收到待审批变更')
    fixture.service.confirmChange(pending.change.id, true, pending.change.sessionId)
    await run
  })
})
