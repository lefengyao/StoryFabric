import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'
import type { AgentEvent, ApprovalPolicy, PendingChange } from '../../../shared/types'
import { getDocumentSnapshot, listHistoryVersions } from '../../workspace/documentWrites'
import type { LlmAdapter } from '../../llm/types'

describe('document history approval', () => {
  for (const mode of ['normal', 'goal', 'orchestration'] as const) {
    for (const approvalPolicy of ['auto', 'strict', 'delete-confirm'] as ApprovalPolicy[]) {
      for (const saveHistory of [true, false]) it(`${mode}/${approvalPolicy} waits for this change's explicit history choice: ${saveHistory}`, async () => {
        const store = new MemoryFileStore()
        await initializeWorkspace(store, '各模式历史确认')
        const kind = saveHistory ? 'chapter' : 'outline'
        const call = { id: 'create', name: kind === 'chapter' ? 'save_chapter' : 'save_outline_doc', argsJson: JSON.stringify(kind === 'chapter'
          ? { chapter: { title: '确认后的草稿', box: 'draft', status: 'draft', content: '最终草稿内容' } }
          : { doc: { title: '确认后的独立章纲', kind: 'chapter', content: '最终章纲内容' } }) }
        const events: AgentEvent[] = []
        let emittedTool = false
        const adapter: LlmAdapter = { stream: async (_model, request) => {
          if (mode === 'goal' && request.tools.length === 0) {
            return { text: request.messages[0]?.text?.includes('输出 JSON：{"passed"') ? '{"passed":true,"reason":"通过"}'
              : '{"tasks":[{"id":"write","title":"保存文档","instructions":"保存文档","acceptanceCriteria":["文档已保存"],"dependsOn":[]}]}', toolCalls: [], stopReason: 'stop' }
          }
          if (mode === 'orchestration' && !request.system.includes('【当前角色】write')) return { text: '已核对资料并形成写作计划。', toolCalls: [], stopReason: 'stop' }
          if (!emittedTool) { emittedTool = true; return { text: '', toolCalls: [call], stopReason: 'tool_calls' } }
          return { text: '完成文档保存。', toolCalls: [], stopReason: 'stop' }
        } }
        let notifyPending!: (change: PendingChange) => void
        const pending = new Promise<PendingChange>((resolve) => { notifyPending = resolve })
        const service = new CoreAgentService({ store, workspaceId: 'history-modes', sessions: new CoreSessionStore(store),
          settings: async () => ({ providers: [{ id: 'test', name: 'test', protocol: 'openai', baseUrl: 'https://example.invalid', apiKey: 'test' }], agentGeneration: { agentTemperature: 70, proseAlternativesEnabled: false } }),
          getAdapter: () => adapter,
          emit: (_sid, event) => { events.push(event); if (event.type === 'pending-change') notifyPending(event.change) } })
        let finished = false
        const running = service.run({ mode, approvalPolicy, message: '保存文档', providerId: 'test', model: 'test', ...(mode === 'orchestration' ? { creative: {
          mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: false, intensity: 'standard', selectedSkillIds: [], selectedRuleSetIds: [],
          orchestration: { mode: 'single', enabled: true, subagentsEnabled: false, enabledStageIds: ['plan', 'setting', 'prompt', 'write'], modelByStage: {}, maxCalls: 8, maxEstimatedTokens: 1_000_000 }
        } } : {}) }).then((result) => { finished = true; return result })
        const change = await Promise.race([pending, running.then(() => { throw new Error('智能体在用户历史选择前已结束') })])
        expect(change.historyEligible).toBe(true)
        expect(finished).toBe(false)
        expect(events.some((event) => event.type === 'change-result' && event.status === 'applied')).toBe(false)
        expect(await store.listFiles(kind === 'chapter' ? 'chapters/draft' : 'outline/unassigned', '.md')).toEqual([])
        expect(await listHistoryVersions(store, kind, change.entityId)).toEqual([])
        expect(() => service.confirmChange(change.id, true, change.sessionId)).toThrow(/版本|选择/)
        await Promise.resolve()
        expect(finished).toBe(false)
        service.confirmChange(change.id, true, change.sessionId, { saveHistory })
        const result = await running
        expect(events.some((event) => event.type === 'error')).toBe(false)
        expect(events.filter((event) => event.type === 'change-result' && event.status === 'applied')).toHaveLength(1)
        expect((await getDocumentSnapshot(store, kind, change.entityId)).document.content).toContain(kind === 'chapter' ? '最终草稿内容' : '最终章纲内容')
        expect((await listHistoryVersions(store, kind, change.entityId)).map((version) => version.source)).toEqual(saveHistory ? ['agent'] : [])
        if (mode === 'goal') { expect(result.status).toBe('completed'); expect(events.some((event) => event.type === 'goal-task' && event.task.status === 'awaiting-approval')).toBe(true) }
        if (mode === 'orchestration') expect(events.some((event) => event.type === 'tool-receipt' && event.receipt.toolName === call.name && event.receipt.status === 'applied')).toBe(true)
      })
    }
  }

  for (const saveHistory of [true, false]) it(`requires an explicit history choice in auto mode: ${saveHistory}`, async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, 'history approval')
    const events: AgentEvent[] = []
    let round = 0
    const adapter: LlmAdapter = { stream: async () => round++ === 0
      ? { text: '', toolCalls: [{ id: 'create', name: 'save_chapter', argsJson: JSON.stringify({ chapter: { title: '新草稿', box: 'draft', status: 'draft', content: '全新的正文' } }) }], stopReason: 'tool_calls' }
      : { text: '章节已保存。', toolCalls: [], stopReason: 'stop' } }
    const service = new CoreAgentService({ store, sessions: new CoreSessionStore(store),
      settings: async () => ({ providers: [{ id: 'test', name: 'test', protocol: 'openai', baseUrl: 'https://example.invalid', apiKey: 'test' }], agentGeneration: { agentTemperature: 70, proseAlternativesEnabled: false } }),
      getAdapter: () => adapter,
      emit: (_sid, event) => {
        events.push(event)
        if (event.type === 'pending-change') {
          expect(event.change.historyEligible).toBe(true)
          expect(() => service.confirmChange(event.change.id, true, undefined)).toThrow(/版本|选择/)
          service.confirmChange(event.change.id, true, undefined, { saveHistory })
        }
      } })
    await service.run({ message: '保存新草稿', providerId: 'test', model: 'test', approvalPolicy: 'auto' })
    expect(events.some((event) => event.type === 'pending-change')).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.some((event) => event.type === 'tool-done' && event.ok === false)).toBe(false)
    expect((await store.listFiles('chapters/draft', '.md')).length).toBe(1)
    const entityDirs = await store.listDirs('.storyfabric/history/chapters')
    expect(entityDirs.length).toBe(saveHistory ? 1 : 0)
  })
})
