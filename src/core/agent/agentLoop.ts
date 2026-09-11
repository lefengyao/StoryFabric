import type { AgentEvent, ChatMessage, ModelSettings, PendingChange, RunAgentRequest, UsageRecord } from '../../shared/types'
import { MAX_TOOL_ROUNDS } from '../../shared/types'
import type { LlmAdapter, LlmAdapterFactory } from '../llm/types'
import { CoreSessionStore, titleFromMessage } from '../workspace/sessionStore'
import type { FileStore } from '../storage/fileStore'
import { executeTool, TOOL_DEFS, type ToolOutcome } from '../tools/registry'
import { resolveModelSettings } from '../llm/modelCatalog'
import { SYSTEM_PROMPT } from './prompts'

export interface AgentSettings {
  providers: Array<{ id: string; protocol: 'openai' | 'anthropic' | 'gemini'; baseUrl: string; apiKey: string; name?: string; modelSettings?: Record<string, ModelSettings> }>
  customPrompt?: string
}

export interface AgentRunOptions {
  store: FileStore
  sessions: CoreSessionStore
  settings: () => Promise<AgentSettings>
  getAdapter: LlmAdapterFactory
  emit: (sessionId: string, event: AgentEvent) => void
  onUsage?: (record: UsageRecord) => void
  executeTool?: (name: string, argsJson: string) => Promise<ToolOutcome>
}

interface Waiter { sessionId: string; resolve: (approved: boolean) => void }

const ATTACHMENT_LABEL: Record<string, string> = {
  character: '人物',
  relationship: '关系',
  outline: '大纲',
  event: '事件',
  chapter: '章节'
}

function userTextForRequest(req: RunAgentRequest): string {
  if (!req.attachments?.length) return req.message
  const lines = req.attachments.map((a) => `[@${ATTACHMENT_LABEL[a.kind] ?? '实体'}：${a.label}，id=${a.id}]`)
  return `${req.message}\n\n${lines.join('\n')}\n（以上是用户显式引用的项目实体，请用工具按 id 查阅其内容）`
}

export class CoreAgentService {
  private aborts = new Map<string, AbortController>()
  private waiters = new Map<string, Waiter>()

  constructor(private readonly options: AgentRunOptions) {}

  confirmChange(id: string, approved: boolean): void {
    const waiter = this.waiters.get(id)
    if (waiter) {
      this.waiters.delete(id)
      waiter.resolve(approved)
    }
  }

  abort(sessionId: string): void {
    this.aborts.get(sessionId)?.abort()
    for (const [id, waiter] of this.waiters) {
      if (waiter.sessionId === sessionId) {
        this.waiters.delete(id)
        waiter.resolve(false)
      }
    }
  }

  private waitConfirm(change: PendingChange, sessionId: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const onAbort = () => {
        this.waiters.delete(change.id)
        resolve(false)
      }
      if (signal.aborted) return resolve(false)
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.set(change.id, {
        sessionId,
        resolve: (approved) => {
          signal.removeEventListener('abort', onAbort)
          resolve(approved)
        }
      })
    })
  }

  async run(req: RunAgentRequest): Promise<{ sessionId: string }> {
    const session = (req.sessionId ? await this.options.sessions.load(req.sessionId) : null) ?? await this.options.sessions.create()
    const sid = session.id
    const user: ChatMessage = { id: `msg_${Date.now().toString(36)}`, role: 'user', text: userTextForRequest(req) }
    session.messages.push(user)
    if (!session.title || session.title === '新会话') session.title = titleFromMessage(req.message)
    const titleAtStart = session.title
    const archivedAtStart = session.archived
    const controller = new AbortController()
    this.aborts.set(sid, controller)
    await this.options.sessions.save(session).catch(() => {})
    this.options.emit(sid, { type: 'session', session })

    try {
      const settings = await this.options.settings()
      const provider = settings.providers.find((item) => item.id === req.providerId)
      if (!provider || !provider.apiKey) throw new Error('找不到可用供应商或 API Key')
      const adapter: LlmAdapter = this.options.getAdapter(provider.protocol, provider.baseUrl)
      const custom = settings.customPrompt?.trim()
      const prompt = custom ? `${SYSTEM_PROMPT}\n\n【用户自定义要求（与内置规则冲突时优先遵守）】\n${custom}` : SYSTEM_PROMPT

      let round = 0
      for (; round < MAX_TOOL_ROUNDS; round++) {
        const assistantId = `msg_${Date.now().toString(36)}_${round}`
        const result = await adapter.stream(
          req.model,
          { system: prompt, messages: session.messages.filter((message) => message.role !== 'system'), tools: TOOL_DEFS, signal: controller.signal, params: resolveModelSettings(provider, req.model) },
          provider.apiKey,
          { onText: (delta) => this.options.emit(sid, { type: 'text-delta', messageId: assistantId, delta }) }
        )
        if (result.usage) this.options.onUsage?.({ at: Date.now(), providerId: provider.id, providerName: provider.name ?? provider.id, model: req.model, ...result.usage })
        session.messages.push({ id: assistantId, role: 'assistant', text: result.text || undefined, toolCalls: result.toolCalls.length ? result.toolCalls : undefined, thinkingBlocks: result.thinkingBlocks })
        if (!result.toolCalls.length) break

        for (const toolCall of result.toolCalls) {
          this.options.emit(sid, { type: 'tool-start', callId: toolCall.id, name: toolCall.name, argsJson: toolCall.argsJson })
          const outcome = await (this.options.executeTool?.(toolCall.name, toolCall.argsJson) ?? executeTool(this.options.store, toolCall.name, toolCall.argsJson))
          if (outcome.kind === 'result') {
            this.options.emit(sid, { type: 'tool-done', callId: toolCall.id, ok: outcome.ok, resultPreview: outcome.preview })
            session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text: outcome.text, isError: !outcome.ok })
            continue
          }

          this.options.emit(sid, { type: 'pending-change', change: outcome.change })
          const approved = await this.waitConfirm(outcome.change, sid, controller.signal)
          this.options.emit(sid, { type: 'change-applied', changeId: outcome.change.id, approved })
          let ok = approved
          let text = '用户拒绝了此变更。请勿原样重复提交。'
          if (approved) {
            try {
              const applied = await outcome.apply()
              ok = applied.ok
              text = applied.text
            } catch (error) {
              ok = false
              text = `写入失败：${error instanceof Error ? error.message : String(error)}`
            }
          }
          this.options.emit(sid, { type: 'tool-done', callId: toolCall.id, ok, resultPreview: ok ? '变更已写入' : approved ? '写入失败' : '用户已拒绝' })
          session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text, isError: !ok })
        }
      }

      if (round >= MAX_TOOL_ROUNDS) session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'assistant', text: `⚠ 连续工具调用已达上限（${MAX_TOOL_ROUNDS} 轮），已停止。请继续对话以接着处理。` })
      this.options.emit(sid, { type: 'done' })
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError'
      const text = aborted ? '已中止本次生成。' : `出错了：${error instanceof Error ? error.message : String(error)}`
      session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'assistant', text, isError: !aborted })
      this.options.emit(sid, { type: 'error', message: text })
      this.options.emit(sid, { type: 'done' })
    } finally {
      const disk = await this.options.sessions.load(sid).catch(() => null)
      if (disk) {
        if (disk.title !== titleAtStart) session.title = disk.title
        if (disk.archived !== archivedAtStart) session.archived = disk.archived
      }
      session.updatedAt = Date.now()
      await this.options.sessions.save(session).catch(() => {})
      this.aborts.delete(sid)
    }
    return { sessionId: sid }
  }
}
