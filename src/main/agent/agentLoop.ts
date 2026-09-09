/**
 * 智能体执行循环：
 * 用户消息 → [LLM 流式生成 → 读工具自动执行回注 / 写工具等用户确认] × N → 结束。
 * 全程通过 emitEvent 向渲染进程推送事件；会话持久化到工作区。
 */
import type { AgentEvent, ChatMessage, RunAgentRequest, UsageRecord } from '../../shared/types'
import { MAX_TOOL_ROUNDS } from '../../shared/types'
import { getAdapter } from '../../core/llm'
import { resolveModelSettings } from '../../core/llm/modelCatalog'
import { AbortedError } from '../../core/llm/types'
import { decryptApiKey } from '../services/settingsService'
import { genId } from '../services/entityStore'
import { SessionStore, titleFromMessage } from '../services/sessionStore'
import type { SettingsService } from '../services/settingsService'
import { executeTool, TOOL_DEFS } from '../tools/registry'
import { SYSTEM_PROMPT } from './prompts'

const ATTACHMENT_LABEL: Record<string, string> = {
  character: '人物',
  relationship: '关系',
  outline: '大纲',
  event: '事件',
  chapter: '章节'
}

interface Waiter {
  sessionId: string
  resolve: (approved: boolean) => void
}

export class AgentService {
  private aborts = new Map<string, AbortController>()
  private waiters = new Map<string, Waiter>()

  constructor(
    private settings: SettingsService,
    private emitEvent: (sessionId: string, event: AgentEvent) => void,
    private onUsage?: (record: UsageRecord) => void
  ) {}

  private emit(sessionId: string, event: AgentEvent): void {
    this.emitEvent(sessionId, event)
  }

  /** 用户在界面上对写变更点了「应用/拒绝」 */
  confirmChange(changeId: string, approved: boolean): void {
    const w = this.waiters.get(changeId)
    if (w) {
      this.waiters.delete(changeId)
      w.resolve(approved)
    }
  }

  abort(sessionId: string): void {
    this.aborts.get(sessionId)?.abort()
    for (const [changeId, w] of this.waiters) {
      if (w.sessionId === sessionId) {
        this.waiters.delete(changeId)
        w.resolve(false)
      }
    }
  }

  private waitConfirm(changeId: string, sessionId: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const onAbort = () => {
        if (this.waiters.delete(changeId)) resolve(false)
      }
      if (signal.aborted) return resolve(false)
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.set(changeId, {
        sessionId,
        resolve: (approved) => {
          signal.removeEventListener('abort', onAbort)
          resolve(approved)
        }
      })
    })
  }

  async run(workspaceRoot: string, req: RunAgentRequest): Promise<{ sessionId: string }> {
    const store = new SessionStore(workspaceRoot)
    const session = (req.sessionId ? await store.load(req.sessionId) : null) ?? (await store.create())
    const sid = session.id

    // 组装用户消息（含 @引用提示）
    let userText = req.message
    if (req.attachments?.length) {
      const lines = req.attachments.map((a) => `[@${ATTACHMENT_LABEL[a.kind] ?? '实体'}：${a.label}，id=${a.id}]`)
      userText += `\n\n${lines.join('\n')}\n（以上是用户显式引用的项目实体，请用工具按 id 查阅其内容）`
    }
    const userMsg: ChatMessage = { id: genId('msg'), role: 'user', text: userText }
    session.messages.push(userMsg)
    if (!session.title || session.title === '新会话') session.title = titleFromMessage(req.message)
    // 记录起始元信息：流式期间用户可能重命名/归档会话，落盘时以磁盘变化为准
    const titleAtStart = session.title
    const archivedAtStart = session.archived

    const controller = new AbortController()
    this.aborts.set(sid, controller)

    this.emit(sid, { type: 'session', session })
    // 立即落盘：保证流式期间用户可以重命名/归档（updateMeta 依赖文件存在）
    await store.save(session).catch(() => {})

    try {
      const settings = await this.settings.load()
      const provider = settings.providers.find((p) => p.id === req.providerId)
      if (!provider) throw new Error('找不到所选供应商，请在设置中检查')
      const apiKey = decryptApiKey(provider.apiKeyEncrypted)
      if (!apiKey) throw new Error(`供应商「${provider.name}」的 API Key 不可用，请在设置中重新填写`)
      const adapter = getAdapter(provider.protocol, provider.baseUrl)
      const custom = settings.customPrompt?.trim()
      const systemPrompt = custom ? `${SYSTEM_PROMPT}\n\n【用户自定义要求（与内置规则冲突时优先遵守）】\n${custom}` : SYSTEM_PROMPT

      let round = 0
      for (; round < MAX_TOOL_ROUNDS; round++) {
        const assistantId = genId('msg')
        const result = await adapter.stream(
          req.model,
          {
            system: systemPrompt,
            messages: session.messages.filter((m) => m.role !== 'system'),
            tools: TOOL_DEFS,
            signal: controller.signal,
            params: resolveModelSettings(provider, req.model)
          },
          apiKey,
          { onText: (delta) => this.emit(sid, { type: 'text-delta', messageId: assistantId, delta }) }
        )

        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          text: result.text || undefined,
          toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
          thinkingBlocks: result.thinkingBlocks
        }
        session.messages.push(assistantMsg)
        if (result.usage) {
          this.onUsage?.({ at: Date.now(), providerId: provider.id, providerName: provider.name || provider.id, model: req.model, ...result.usage })
        }

        if (!result.toolCalls.length) break

        for (const tc of result.toolCalls) {
          this.emit(sid, { type: 'tool-start', callId: tc.id, name: tc.name, argsJson: tc.argsJson })
          const outcome = await executeTool(workspaceRoot, tc.name, tc.argsJson)

          if (outcome.kind === 'result') {
            this.emit(sid, { type: 'tool-done', callId: tc.id, ok: outcome.ok, resultPreview: outcome.preview })
            session.messages.push({ id: genId('msg'), role: 'tool', toolCallId: tc.id, toolName: tc.name, text: outcome.text, isError: !outcome.ok })
          } else {
            this.emit(sid, { type: 'pending-change', change: outcome.change })
            const approved = await this.waitConfirm(outcome.change.id, sid, controller.signal)
            this.emit(sid, { type: 'change-applied', changeId: outcome.change.id, approved })
            let text: string
            if (approved) {
              const r = await outcome.apply()
              text = r.text
            } else {
              text = '用户拒绝了此变更。请勿原样重复提交；可以询问用户希望如何调整。'
            }
            this.emit(sid, { type: 'tool-done', callId: tc.id, ok: approved, resultPreview: approved ? '变更已写入' : '用户已拒绝' })
            session.messages.push({ id: genId('msg'), role: 'tool', toolCallId: tc.id, toolName: tc.name, text })
          }
        }
      }
      if (round >= MAX_TOOL_ROUNDS) {
        session.messages.push({
          id: genId('msg'),
          role: 'assistant',
          text: `⚠ 连续工具调用已达上限（${MAX_TOOL_ROUNDS} 轮），已停止。请继续对话以接着处理。`
        })
      }
      this.emit(sid, { type: 'done' })
    } catch (err) {
      const aborted = err instanceof AbortedError || (err as Error)?.name === 'AbortError'
      const msg = aborted ? '已中止本次生成。' : `出错了：${err instanceof Error ? err.message : String(err)}`
      session.messages.push({ id: genId('msg'), role: 'assistant', text: msg, isError: !aborted })
      this.emit(sid, { type: 'error', message: msg })
      this.emit(sid, { type: 'done' })
    } finally {
      // 合并流式期间发生的元信息变更（重命名/归档），避免整体回存覆盖
      const disk = await store.load(sid).catch(() => null)
      if (disk) {
        if (disk.title !== titleAtStart) session.title = disk.title
        if (disk.archived !== archivedAtStart) session.archived = disk.archived
      }
      session.updatedAt = Date.now()
      await store.save(session).catch(() => {})
      this.aborts.delete(sid)
    }
    return { sessionId: sid }
  }
}
