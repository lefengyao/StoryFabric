import type { AgentEvent, ChatMessage, ChatSession, PendingChange, RunAgentRequest, UsageRecord } from '../../shared/types'
import { MAX_TOOL_ROUNDS } from '../../shared/types'
import type { LlmAdapter, LlmAdapterFactory } from '../llm/types'
import { CoreSessionStore } from '../workspace/sessionStore'
import type { FileStore } from '../storage/fileStore'
import { executeTool, TOOL_DEFS } from '../tools/registry'
import { SYSTEM_PROMPT } from './prompts'

export interface AgentSettings { providers: Array<{ id: string; protocol: 'openai' | 'anthropic' | 'gemini'; baseUrl: string; apiKey: string; name?: string }>; customPrompt?: string }
export interface AgentRunOptions { store: FileStore; sessions: CoreSessionStore; settings: () => Promise<AgentSettings>; getAdapter: LlmAdapterFactory; emit: (sessionId: string, event: AgentEvent) => void; onUsage?: (record: UsageRecord) => void }

interface Waiter { sessionId: string; resolve: (approved: boolean) => void }

export class CoreAgentService {
  private aborts = new Map<string, AbortController>()
  private waiters = new Map<string, Waiter>()
  constructor(private readonly options: AgentRunOptions) {}

  confirmChange(id: string, approved: boolean): void { const w = this.waiters.get(id); if (w) { this.waiters.delete(id); w.resolve(approved) } }
  abort(sessionId: string): void { this.aborts.get(sessionId)?.abort(); for (const [id, w] of this.waiters) if (w.sessionId === sessionId) { this.waiters.delete(id); w.resolve(false) } }
  private waitConfirm(change: PendingChange, sessionId: string, signal: AbortSignal): Promise<boolean> { return new Promise((resolve) => { const done = (v: boolean) => { signal.removeEventListener('abort', onAbort); resolve(v) }; const onAbort = () => { this.waiters.delete(change.id); resolve(false) }; if (signal.aborted) return resolve(false); signal.addEventListener('abort', onAbort, { once: true }); this.waiters.set(change.id, { sessionId, resolve: done }) }) }

  async run(req: RunAgentRequest): Promise<{ sessionId: string }> {
    const session = (req.sessionId ? await this.options.sessions.load(req.sessionId) : null) ?? await this.options.sessions.create(); const sid = session.id; const user: ChatMessage = { id: `msg_${Date.now().toString(36)}`, role: 'user', text: req.message }; session.messages.push(user); if (!session.title || session.title === '新会话') session.title = req.message.trim().slice(0, 24) || '新会话'; await this.options.sessions.save(session); this.options.emit(sid, { type: 'session', session });
    const settings = await this.options.settings(); const provider = settings.providers.find((p) => p.id === req.providerId); if (!provider || !provider.apiKey) throw new Error('找不到可用供应商或 API Key')
    const adapter: LlmAdapter = this.options.getAdapter(provider.protocol, provider.baseUrl); const controller = new AbortController(); this.aborts.set(sid, controller); const prompt = settings.customPrompt?.trim() ? `${SYSTEM_PROMPT}\n\n${settings.customPrompt}` : SYSTEM_PROMPT
    try {
      let round = 0
      for (; round < MAX_TOOL_ROUNDS; round++) {
        const assistantId = `msg_${Date.now().toString(36)}_${round}`; const result = await adapter.stream(req.model, { system: prompt, messages: session.messages, tools: TOOL_DEFS, signal: controller.signal }, provider.apiKey, { onText: (delta) => this.options.emit(sid, { type: 'text-delta', messageId: assistantId, delta }) }); if (result.usage) this.options.onUsage?.({ at: Date.now(), providerId: provider.id, providerName: provider.name ?? provider.id, model: req.model, ...result.usage }); session.messages.push({ id: assistantId, role: 'assistant', text: result.text || undefined, toolCalls: result.toolCalls.length ? result.toolCalls : undefined }); if (!result.toolCalls.length) break
        for (const tc of result.toolCalls) { this.options.emit(sid, { type: 'tool-start', callId: tc.id, name: tc.name, argsJson: tc.argsJson }); const outcome = await executeTool(this.options.store, tc.name, tc.argsJson); if (outcome.kind === 'result') { this.options.emit(sid, { type: 'tool-done', callId: tc.id, ok: outcome.ok, resultPreview: outcome.preview }); session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: tc.id, toolName: tc.name, text: outcome.text, isError: !outcome.ok }) } else { this.options.emit(sid, { type: 'pending-change', change: outcome.change }); const approved = await this.waitConfirm(outcome.change, sid, controller.signal); this.options.emit(sid, { type: 'change-applied', changeId: outcome.change.id, approved }); const text = approved ? (await outcome.apply()).text : '用户拒绝了此变更。请勿原样重复提交。'; this.options.emit(sid, { type: 'tool-done', callId: tc.id, ok: approved, resultPreview: approved ? '变更已写入' : '用户已拒绝' }); session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: tc.id, toolName: tc.name, text }) } }
      }
      if (round >= MAX_TOOL_ROUNDS) session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'assistant', text: `连续工具调用已达上限（${MAX_TOOL_ROUNDS} 轮），已停止。` }); this.options.emit(sid, { type: 'done' })
    } catch (err) { const text = (err as Error)?.name === 'AbortError' ? '已中止本次生成。' : `出错了：${err instanceof Error ? err.message : String(err)}`; session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'assistant', text, isError: true }); this.options.emit(sid, { type: 'error', message: text }); this.options.emit(sid, { type: 'done' }) } finally { session.updatedAt = Date.now(); await this.options.sessions.save(session).catch(() => {}); this.aborts.delete(sid) }
    return { sessionId: sid }
  }
}
