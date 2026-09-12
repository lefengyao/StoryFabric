import type { AgentEvent, ChatMessage, ChatSession, ModelSettings, PendingChange, RunAgentRequest, ToolCallData, UsageRecord } from '../../shared/types'
import { MAX_TOOL_ROUNDS } from '../../shared/types'
import type { LlmAdapter, LlmAdapterFactory } from '../llm/types'
import { CoreSessionStore, titleFromMessage } from '../workspace/sessionStore'
import type { FileStore } from '../storage/fileStore'
import { executeTool, TOOL_DEFS, type ToolOutcome } from '../tools/registry'
import { resolveModelSettings } from '../llm/modelCatalog'
import { SYSTEM_PROMPT } from './prompts'
import { validateMessageFiles } from '../attachments/validation'
import { profileForModel } from '../llm/modelCatalog'
import {
  estimateTextTokens,
  fallbackContextSummary,
  messagesAfterSummary,
  planContextCompression,
  resolveContextUsage,
  summaryTranscriptChunks
} from './contextWindow'

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

const CONTEXT_SUMMARY_PROMPT = `你是 StoryFabric 的对话上下文压缩器。
你的任务是把较早的智能体对话压缩成后续仍然可用的工作记忆，不执行任何工具，不编造事实。

保留：
- 用户明确提出的目标、偏好和限制；
- 已经完成的修改、涉及的文件/实体 id 和当前状态；
- 尚未完成、等待确认或失败的事项；
- 对话中形成且后续仍需要遵守的决策；
- 与当前任务直接相关的重要事实。

合并重复内容。不要把工具返回的整段 JSON 原样抄回，不要输出寒暄，不要声称已经执行未执行的操作。
输出简洁的 Markdown 列表，控制在 1200 字以内。`

const ATTACHMENT_LABEL: Record<string, string> = {
  character: '人物',
  relationship: '关系',
  outline: '大纲',
  event: '事件',
  chapter: '章节',
  projectDoc: '项目文档'
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

  private async compressContextIfNeeded(options: {
    session: ChatSession
    adapter: LlmAdapter
    apiKey: string
    providerId: string
    providerName: string
    model: string
    contextTokens: number
    maxOutputTokens: number
    systemPrompt: string
    signal: AbortSignal
    sessionId: string
  }): Promise<void> {
    const plan = planContextCompression({
      messages: options.session.messages,
      contextTokens: options.contextTokens,
      maxOutputTokens: options.maxOutputTokens,
      summaryThrough: options.session.contextSummaryThrough,
      summaryTokens: estimateTextTokens(options.session.contextSummary),
      systemTokens: estimateTextTokens(options.systemPrompt)
    })
    if (!plan) return

    this.options.emit(options.sessionId, {
      type: 'context-compression-start',
      beforeTokens: plan.beforeTokens,
      contextTokens: options.contextTokens
    })

    let summary = options.session.contextSummary?.trim() ?? ''
    try {
      const chunks = summaryTranscriptChunks(plan.oldMessages, Math.max(12000, options.contextTokens * 2))
      for (const chunk of chunks) {
        const result = await options.adapter.stream(
          options.model,
          {
            system: CONTEXT_SUMMARY_PROMPT,
            messages: [{
              id: `summary_${Date.now().toString(36)}`,
              role: 'user',
              text: [
                summary ? `【已有摘要】\n${summary}` : '',
                `【本次需要合并的对话】\n${chunk}`
              ].filter(Boolean).join('\n\n')
            }],
            tools: [],
            signal: options.signal,
            params: {
              reasoning: 'off',
              contextTokens: options.contextTokens,
              maxOutputTokens: Math.min(4096, options.maxOutputTokens)
            }
          },
          options.apiKey,
          { onText: () => undefined }
        )
        if (result.usage) {
          this.options.onUsage?.({
            at: Date.now(),
            providerId: options.providerId,
            providerName: options.providerName,
            model: options.model,
            ...result.usage
          })
        }
        summary = result.text.trim() || fallbackContextSummary(summary, plan.oldMessages)
      }
    } catch (error) {
      if (options.signal.aborted) throw error
      summary = fallbackContextSummary(summary, plan.oldMessages)
    }

    options.session.contextSummary = summary
    options.session.contextSummaryThrough = plan.throughMessageId
    options.session.contextSummaryUpdatedAt = Date.now()
    await this.options.sessions.save(options.session).catch(() => {})

    const usage = resolveContextUsage({
      messages: options.session.messages,
      contextTokens: options.contextTokens,
      maxOutputTokens: options.maxOutputTokens,
      summaryThrough: options.session.contextSummaryThrough,
      summaryTokens: estimateTextTokens(summary),
      systemTokens: estimateTextTokens(options.systemPrompt)
    })
    this.options.emit(options.sessionId, {
      type: 'context-compressed',
      beforeTokens: plan.beforeTokens,
      afterTokens: usage.usedTokens,
      summarizedMessages: plan.oldMessages.length,
      throughMessageId: plan.throughMessageId,
      summaryUpdatedAt: options.session.contextSummaryUpdatedAt
    })
  }

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
    const message = req.message.trim() || (req.files?.length ? '请分析所附资料。' : '')
    const files = validateMessageFiles(req.files ?? [])
    const user: ChatMessage = { id: `msg_${Date.now().toString(36)}`, role: 'user', text: userTextForRequest({ ...req, message }), ...(files.length ? { files } : {}) }
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
      const profile = profileForModel(req.model)
      const vision = provider.modelSettings?.[req.model]?.vision ?? profile.vision
      if (files.some((file) => file.kind === 'image') && !vision) throw new Error('当前模型不支持图片输入，请切换模型或移除图片')
      const adapter: LlmAdapter = this.options.getAdapter(provider.protocol, provider.baseUrl)
      const custom = settings.customPrompt?.trim()
      const prompt = custom ? `${SYSTEM_PROMPT}\n\n【用户自定义要求（与内置规则冲突时优先遵守）】\n${custom}` : SYSTEM_PROMPT
      const resolvedSettings = resolveModelSettings(provider, req.model)
      const effectiveSettings = req.reasoning === undefined ? resolvedSettings : { ...resolvedSettings, reasoning: req.reasoning }
      user.runSettings = { providerId: provider.id, model: req.model, reasoning: effectiveSettings.reasoning }
      await this.options.sessions.save(session).catch(() => {})

      await this.compressContextIfNeeded({
        session,
        adapter,
        apiKey: provider.apiKey,
        providerId: provider.id,
        providerName: provider.name ?? provider.id,
        model: req.model,
        contextTokens: effectiveSettings.contextTokens,
        maxOutputTokens: effectiveSettings.maxOutputTokens,
        systemPrompt: prompt,
        signal: controller.signal,
        sessionId: sid
      })
      const promptWithSummary = session.contextSummary
        ? `${prompt}\n\n【较早对话的压缩摘要】\n${session.contextSummary}`
        : prompt
      const modelMessages = (): ChatMessage[] =>
        messagesAfterSummary(session.messages, session.contextSummaryThrough).filter((message) => message.role !== 'system')

      let round = 0
      let previousToolSignature = ''
      let repeatedToolRounds = 0
      for (; round < MAX_TOOL_ROUNDS; round++) {
        const assistantId = `msg_${Date.now().toString(36)}_${round}`
        const result = await adapter.stream(
          req.model,
          { system: promptWithSummary, messages: modelMessages(), tools: TOOL_DEFS, signal: controller.signal, params: effectiveSettings },
          provider.apiKey,
          { onText: (delta) => this.options.emit(sid, { type: 'text-delta', messageId: assistantId, delta }) }
        )
        if (result.usage) this.options.onUsage?.({ at: Date.now(), providerId: provider.id, providerName: provider.name ?? provider.id, model: req.model, ...result.usage })
        session.messages.push({ id: assistantId, role: 'assistant', text: result.text || undefined, toolCalls: result.toolCalls.length ? result.toolCalls : undefined, thinkingBlocks: result.thinkingBlocks })
        if (!result.toolCalls.length) break

        const signature = toolRoundSignature(result.toolCalls)
        if (signature === previousToolSignature) repeatedToolRounds += 1
        else repeatedToolRounds = 1
        previousToolSignature = signature
        if (repeatedToolRounds >= 3) {
          session.messages.push({
            id: `msg_${Date.now().toString(36)}`,
            role: 'assistant',
            text: '检测到连续 3 轮调用完全相同的工具和参数，已停止以避免循环。请调整要求或继续对话后再试。'
          })
          break
        }

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
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError'
      const text = aborted ? '已中止本次生成。' : `出错了：${error instanceof Error ? error.message : String(error)}`
      session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'assistant', text, isError: !aborted })
      this.options.emit(sid, { type: 'error', message: text })
    } finally {
      const disk = await this.options.sessions.load(sid).catch(() => null)
      if (disk) {
        if (disk.title !== titleAtStart) session.title = disk.title
        if (disk.archived !== archivedAtStart) session.archived = disk.archived
      }
      session.updatedAt = Date.now()
      await this.options.sessions.save(session).catch(() => {})
      this.options.emit(sid, { type: 'done', session })
      this.aborts.delete(sid)
    }
    return { sessionId: sid }
  }
}

function toolRoundSignature(calls: ToolCallData[]): string {
  return calls
    .map((call) => `${call.name}:${call.argsJson}`)
    .sort()
    .join('\n')
}
