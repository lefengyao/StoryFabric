import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatSession } from '../../../shared/types'
import type { LlmAdapterFactory } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

describe('CoreAgentService session concurrency', () => {
  it('overlaps model calls for different sessions while keeping their results isolated', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '跨会话并发')
    const sessions = new CoreSessionStore(store)
    const firstSession = await sessions.create()
    const secondSession = await sessions.create()
    await sessions.save(firstSession)
    await sessions.save(secondSession)

    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let resolveFirstStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => { resolveFirstStarted = resolve })
    let resolveSecondStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => { resolveSecondStarted = resolve })

    const factory: LlmAdapterFactory = () => ({
      stream: async (_model, request) => {
        const userMessage = request.messages.findLast((item) => item.role === 'user')?.text
        if (userMessage === '第一个并发任务') {
          resolveFirstStarted()
          await firstGate
          return { text: '第一个任务完成', toolCalls: [], stopReason: 'stop' as const }
        }
        if (userMessage === '第二个并发任务') {
          resolveSecondStarted()
          return { text: '第二个任务完成', toolCalls: [], stopReason: 'stop' as const }
        }
        throw new Error(`未预期的用户消息：${userMessage ?? '(空)'}`)
      }
    })

    const events: Array<{ sessionId: string; event: AgentEvent; runId?: string }> = []
    const service = new CoreAgentService({
      store,
      sessions,
      settings: async () => ({ providers: [{ id: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'test' }] }),
      getAdapter: factory,
      emit: (sessionId, event, runId) => events.push({ sessionId, event, runId })
    })

    const first = service.run({ sessionId: firstSession.id, providerId: 'mock', model: 'mock', message: '第一个并发任务' })
    await firstStarted
    const second = service.run({ sessionId: secondSession.id, providerId: 'mock', model: 'mock', message: '第二个并发任务' })

    let secondStartError: unknown
    try {
      await Promise.race([
        secondStarted,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('第二个会话未能在第一个会话释放前开始')), 2000))
      ])
    } catch (error) {
      secondStartError = error
    }

    releaseFirst()
    const [firstResult, secondResult] = await Promise.all([first, second])
    if (secondStartError) throw secondStartError

    expect(firstResult.sessionId).toBe(firstSession.id)
    expect(secondResult.sessionId).toBe(secondSession.id)
    expect(firstResult.runId).not.toBe(secondResult.runId)
    expect((await sessions.load(firstSession.id) as ChatSession | null)?.messages.at(-1)?.text).toBe('第一个任务完成')
    expect((await sessions.load(secondSession.id) as ChatSession | null)?.messages.at(-1)?.text).toBe('第二个任务完成')
    expect(events.filter((item) => item.event.type === 'done').map((item) => item.sessionId).sort()).toEqual([firstSession.id, secondSession.id].sort())
    expect(events.filter((item) => item.event.type === 'done').every((item) => item.runId)).toBe(true)
  })
})
