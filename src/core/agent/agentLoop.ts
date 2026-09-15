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
import { normalizeCreativePreferences } from '../../shared/creative'
import { builtinPackages } from '../skills/builtin'
import { ContentPackageStore } from '../skills/packageStore'
import type { ContentPackage } from '../skills/types'
import { ModelCallGateway } from './modelCallGateway'
import { OrchestrationScheduler } from '../orchestration/scheduler'
import type { StageId } from '../orchestration/types'
import { RuleStore } from '../rules/ruleStore'
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
  workspaceId?: string
  sessions: CoreSessionStore
  settings: () => Promise<AgentSettings>
  getAdapter: LlmAdapterFactory
  emit: (sessionId: string, event: AgentEvent, runId?: string) => void
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

function creativeGuidance(creative: ReturnType<typeof normalizeCreativePreferences>, packages: ContentPackage[] = builtinPackages): string {
  const selectedSkillIds = new Set(creative.selectedSkillIds)
  const selectedRuleSetIds = new Set(creative.selectedRuleSetIds)
  return packages.flatMap((pkg) => {
    const skillSelected = pkg.manifest.skills.some((skill) => selectedSkillIds.has(skill.id) || selectedSkillIds.has(pkg.manifest.id))
    const ruleSelected = pkg.manifest.ruleSets.some((ruleSet) => selectedRuleSetIds.has(ruleSet.id) || selectedRuleSetIds.has(pkg.manifest.id))
    const values: string[] = []
    if (skillSelected) values.push(...pkg.manifest.skills.map((skill) => pkg.files.find((file) => file.path === skill.path)?.content ?? ''))
    if (ruleSelected) {
      for (const entry of pkg.manifest.ruleSets) {
        const file = pkg.files.find((item) => item.path === entry.path)
        try {
          const parsed = JSON.parse(file?.content ?? '{}') as { rules?: Array<{ key?: string; value?: unknown; severity?: string }> }
          values.push(...(parsed.rules ?? []).map((rule) => `规则 ${rule.key ?? '未命名'}（${rule.severity ?? 'prefer'}）：${JSON.stringify(rule.value)}`))
        } catch { /* validated packages only; ignore malformed optional guidance */ }
      }
    }
    return values
  }).filter(Boolean).join('\n\n')
}

function promptWithCreativeGuidance(prompt: string, creative: ReturnType<typeof normalizeCreativePreferences>, packages: ContentPackage[] = builtinPackages): string {
  const guidance = creativeGuidance(creative, packages)
  return guidance ? `${prompt}\n\n【本次启用的创作技能】\n${guidance}` : prompt
}

export class CoreAgentService {
  private aborts = new Map<string, AbortController>()
  private activeRunIds = new Map<string, string>()
  private pendingRunIds = new Map<string, string>()
  private waiters = new Map<string, Waiter>()

  constructor(private readonly options: AgentRunOptions) {}

  private emit(sessionId: string, event: AgentEvent, runId?: string): void {
    this.options.emit(sessionId, event, runId ?? this.activeRunIds.get(sessionId))
  }

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
    gateway: ModelCallGateway
    runId: string
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

    this.emit(options.sessionId, {
      type: 'context-compression-start',
      beforeTokens: plan.beforeTokens,
      contextTokens: options.contextTokens
    })

    let summary = options.session.contextSummary?.trim() ?? ''
    try {
      const chunks = summaryTranscriptChunks(plan.oldMessages, Math.max(12000, options.contextTokens * 2))
      for (const chunk of chunks) {
        const result = await options.gateway.call({
          callId: `${options.runId}:compression:${options.sessionId}:${options.session.contextSummaryThrough ?? 'start'}:${chunk.slice(0, 24)}`,
          runId: options.runId,
          agentId: 'context-compression',
          purpose: 'compression',
          providerId: options.providerId,
          providerName: options.providerName,
          model: options.model,
          estimatedInputTokens: Math.max(1, estimateTextTokens(CONTEXT_SUMMARY_PROMPT) + estimateTextTokens(chunk) + estimateTextTokens(summary)),
          maxOutputTokens: Math.min(4096, options.maxOutputTokens),
          execute: () => options.adapter.stream(
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
        })
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
    this.emit(options.sessionId, {
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

  /** Returns the acceptance id immediately after run() has been invoked. */
  getActiveRunId(sessionId: string): string | undefined { return this.activeRunIds.get(sessionId) ?? this.pendingRunIds.get(sessionId) }

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

  private async runOrchestration(options: {
    runId: string
    sessionId: string
    message: string
    creative: ReturnType<typeof normalizeCreativePreferences>
    adapter: LlmAdapter
    apiKey: string
    providerId: string
    providerName: string
    model: string
    prompt: string
    modelSettings: ModelSettings
    signal: AbortSignal
    session: ChatSession
    gateway: ModelCallGateway
  }): Promise<void> {
    const orchestration = options.creative.orchestration
    const maxEstimatedTokens = orchestration?.maxEstimatedTokens ?? 100000
    const gateway = options.gateway
    const system = options.prompt
    const scheduler = new OrchestrationScheduler({
      call: async ({ stageId, prompt }) => {
        this.emit(options.sessionId, { type: 'stage-start', stageId }, options.runId)
        const messageId = `${options.runId}_${stageId}`
        const estimatedInputTokens = Math.max(1, estimateTextTokens(prompt))
        let result
        try {
          result = await gateway.call({
          callId: `${options.runId}:${stageId}`,
          runId: options.runId,
          stageId,
          agentId: stageId,
          purpose: 'stage',
          providerId: options.providerId,
          providerName: options.providerName,
          model: options.model,
          estimatedInputTokens,
          maxOutputTokens: Math.max(1, Math.min(options.modelSettings.maxOutputTokens, maxEstimatedTokens - estimatedInputTokens)),
          execute: () => options.adapter.stream(options.model, {
            system,
            messages: [{ id: messageId, role: 'user', text: prompt }],
            tools: [],
            signal: options.signal,
            params: options.modelSettings
          }, options.apiKey, { onText: (delta) => this.emit(options.sessionId, { type: 'text-delta', messageId, delta }, options.runId) })
          })
        } catch (error) {
          this.emit(options.sessionId, { type: 'error', message: `阶段 ${stageId} 失败：${error instanceof Error ? error.message : String(error)}` }, options.runId)
          throw error
        }
        this.emit(options.sessionId, { type: 'stage-complete', stageId }, options.runId)
        return { text: result.text }
      }
    })
    const configuredStages = orchestration?.enabledStageIds ?? []
    const enabledStageIds = configuredStages.length
      ? configuredStages.filter((stageId): stageId is StageId => ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'].includes(stageId))
      : undefined
    const result = await scheduler.run({
      runId: options.runId,
      workspaceId: this.options.workspaceId ?? 'workspace',
      sourceRevision: 0,
      goal: options.message,
      originalText: '',
      enabledStageIds
    })
    const finalText = result.artifacts.find((artifact) => artifact.stageId === 'write')?.text ?? result.artifacts.at(-1)?.text
    if (finalText?.trim()) options.session.messages.push({ id: `msg_${Date.now().toString(36)}_orchestration`, role: 'assistant', text: finalText })
  }

  async run(req: RunAgentRequest): Promise<{ sessionId: string; runId: string }> {
    const reservedRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    if (req.sessionId) this.pendingRunIds.set(req.sessionId, reservedRunId)
    const session = (req.sessionId ? await this.options.sessions.load(req.sessionId) : null) ?? await this.options.sessions.create()
    const sid = session.id
    if (req.creative !== undefined) {
      session.creativePreferences = normalizeCreativePreferences(req.creative)
    }
    const message = req.message.trim() || (req.files?.length ? '请分析所附资料。' : '')
    const files = validateMessageFiles(req.files ?? [])
    const user: ChatMessage = { id: `msg_${Date.now().toString(36)}`, role: 'user', text: userTextForRequest({ ...req, message }), ...(files.length ? { files } : {}) }
    session.messages.push(user)
    if (!session.title || session.title === '新会话') session.title = titleFromMessage(req.message)
    const titleAtStart = session.title
    const archivedAtStart = session.archived
    const controller = new AbortController()
    const runId = reservedRunId
    if (req.sessionId) this.pendingRunIds.delete(req.sessionId)
    this.activeRunIds.set(sid, runId)
    const streamedText = new Map<string, string>()
    this.aborts.set(sid, controller)
    await this.options.sessions.save(session).catch(() => {})
    this.emit(sid, { type: 'session', session }, runId)

    try {
      const settings = await this.options.settings()
      const provider = settings.providers.find((item) => item.id === req.providerId)
      if (!provider || !provider.apiKey) throw new Error('找不到可用供应商或 API Key')
      const profile = profileForModel(req.model)
      const vision = provider.modelSettings?.[req.model]?.vision ?? profile.vision
      if (files.some((file) => file.kind === 'image') && !vision) throw new Error('当前模型不支持图片输入，请切换模型或移除图片')
      const adapter: LlmAdapter = this.options.getAdapter(provider.protocol, provider.baseUrl)
      const custom = settings.customPrompt?.trim()
      const basePrompt = custom ? `${SYSTEM_PROMPT}\n\n【用户自定义要求（与内置规则冲突时优先遵守）】\n${custom}` : SYSTEM_PROMPT
      const installedPackages = await new ContentPackageStore(this.options.store).list().catch(() => [])
      const disabledBuiltins = new Set(installedPackages.filter((item) => builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version) && !item.enabled).map((item) => `${item.manifest.id}@${item.manifest.version}`))
      const activeBuiltins = builtinPackages.filter((item) => !disabledBuiltins.has(`${item.manifest.id}@${item.manifest.version}`))
      const activeInstalled = installedPackages.filter((item) => item.enabled && !builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version))
      const creative = session.creativePreferences ?? normalizeCreativePreferences(undefined)
      const workspaceRules = await new RuleStore(this.options.store).load().catch(() => [])
      const ruleGuidance = workspaceRules.flatMap((layer) => layer.rules.filter((rule) => rule.enabled).map((rule) => `工作区规则 ${rule.target}.${rule.key}（${rule.severity}）：${JSON.stringify(rule.value)}`)).join('\n')
      const prompt = `${promptWithCreativeGuidance(basePrompt, creative, [...activeBuiltins, ...activeInstalled])}${ruleGuidance ? `\n\n【工作区规则】\n${ruleGuidance}` : ''}`
      const resolvedSettings = resolveModelSettings(provider, req.model)
      const effectiveSettings = req.reasoning === undefined ? resolvedSettings : { ...resolvedSettings, reasoning: req.reasoning }
      const basicGateway = new ModelCallGateway({
        maxCalls: session.creativePreferences?.orchestration?.maxCalls ?? MAX_TOOL_ROUNDS,
        maxEstimatedTokens: session.creativePreferences?.orchestration?.maxEstimatedTokens ?? 100000000
      }, (record) => this.options.onUsage?.(record))
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
        sessionId: sid,
        gateway: basicGateway,
        runId
      })
      const promptWithSummary = session.contextSummary
        ? `${prompt}\n\n【较早对话的压缩摘要】\n${session.contextSummary}`
        : prompt
      const modelMessages = (): ChatMessage[] =>
        messagesAfterSummary(session.messages, session.contextSummaryThrough).filter((message) => message.role !== 'system')

      if (session.creativePreferences?.orchestrationEnabled) {
        await this.runOrchestration({
          runId,
          sessionId: sid,
          message,
          creative: session.creativePreferences,
          adapter,
          apiKey: provider.apiKey,
          providerId: provider.id,
          providerName: provider.name ?? provider.id,
          model: req.model,
          prompt: promptWithSummary,
          modelSettings: effectiveSettings,
          signal: controller.signal,
          session,
          gateway: basicGateway
        })
      } else {
        let round = 0
        let previousToolSignature = ''
        let repeatedToolRounds = 0
        const toolArgBuffers = new Map<string, string>()
        for (; round < MAX_TOOL_ROUNDS; round++) {
        const assistantId = `msg_${Date.now().toString(36)}_${round}`
        const messages = modelMessages()
        const result = await basicGateway.call({
          callId: `${runId}:basic:${round}`,
          runId,
          agentId: 'basic',
          purpose: 'basic',
          providerId: provider.id,
          providerName: provider.name ?? provider.id,
          model: req.model,
          estimatedInputTokens: Math.max(1, estimateTextTokens(promptWithSummary) + messages.reduce((sum, item) => sum + estimateTextTokens(item.text), 0)),
          maxOutputTokens: effectiveSettings.maxOutputTokens,
          execute: () => adapter.stream(
            req.model,
            { system: promptWithSummary, messages, tools: TOOL_DEFS, signal: controller.signal, params: effectiveSettings },
            provider.apiKey,
            { onText: (delta) => {
              streamedText.set(assistantId, `${streamedText.get(assistantId) ?? ''}${delta}`)
              this.emit(sid, { type: 'text-delta', messageId: assistantId, delta }, runId)
            },
            onToolCallStart: (callId, name) => this.emit(sid, { type: 'tool-start', callId, name, argsJson: toolArgBuffers.get(callId) ?? '' }, runId),
            onToolArgsDelta: (callId, delta) => {
              toolArgBuffers.set(callId, `${toolArgBuffers.get(callId) ?? ''}${delta}`)
              this.emit(sid, { type: 'tool-args-delta', callId, delta }, runId)
            },
            onToolCallComplete: (callId, _name, argsJson) => { toolArgBuffers.set(callId, argsJson) }
            }
          )
        })
        session.messages.push({ id: assistantId, role: 'assistant', text: result.text || streamedText.get(assistantId) || undefined, toolCalls: result.toolCalls.length ? result.toolCalls : undefined, thinkingBlocks: result.thinkingBlocks })
        streamedText.delete(assistantId)
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
          this.emit(sid, { type: 'tool-start', callId: toolCall.id, name: toolCall.name, argsJson: toolCall.argsJson }, runId)
          const outcome = await (this.options.executeTool?.(toolCall.name, toolCall.argsJson) ?? executeTool(this.options.store, toolCall.name, toolCall.argsJson))
          if (outcome.kind === 'result') {
            this.emit(sid, { type: 'tool-done', callId: toolCall.id, ok: outcome.ok, resultPreview: outcome.preview }, runId)
            session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text: outcome.text, isError: !outcome.ok })
            continue
          }

          this.emit(sid, { type: 'pending-change', change: outcome.change }, runId)
          const approved = await this.waitConfirm(outcome.change, sid, controller.signal)
          let ok = approved
          let text = '用户拒绝了此变更。请勿原样重复提交。'
          let status: 'applied' | 'rejected' | 'conflict' | 'failed' = 'rejected'
          if (approved) {
            try {
              const applied = await outcome.apply()
              ok = applied.ok
              text = applied.text
              status = applied.ok ? 'applied' : text.includes('等待期间修改') ? 'conflict' : 'failed'
            } catch (error) {
              ok = false
              text = `写入失败：${error instanceof Error ? error.message : String(error)}`
              status = 'failed'
            }
          }
          this.emit(sid, { type: 'change-result', changeId: outcome.change.id, status, message: text }, runId)
          this.emit(sid, { type: 'tool-done', callId: toolCall.id, ok, resultPreview: ok ? '变更已写入' : approved ? '写入失败' : '用户已拒绝' }, runId)
          session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text, isError: !ok })
        }
        }

        if (round >= MAX_TOOL_ROUNDS) session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'assistant', text: `⚠ 连续工具调用已达上限（${MAX_TOOL_ROUNDS} 轮），已停止。请继续对话以接着处理。` })
      }
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError'
      const partials = [...streamedText.entries()]
      for (const [messageId, partial] of partials) {
        if (partial) session.messages.push({ id: messageId, role: 'assistant', text: partial })
      }
      const text = aborted ? '已中止本次生成。' : `出错了：${error instanceof Error ? error.message : String(error)}`
      session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'assistant', text, isError: !aborted })
      this.emit(sid, { type: 'error', message: text }, runId)
    } finally {
      const disk = await this.options.sessions.load(sid).catch(() => null)
      if (disk) {
        if (disk.title !== titleAtStart) session.title = disk.title
        if (disk.archived !== archivedAtStart) session.archived = disk.archived
      }
      session.updatedAt = Date.now()
      await this.options.sessions.save(session).catch(() => {})
      this.emit(sid, { type: 'done', session }, runId)
      this.aborts.delete(sid)
      this.activeRunIds.delete(sid)
    }
    return { sessionId: sid, runId }
  }
}

function toolRoundSignature(calls: ToolCallData[]): string {
  return calls
    .map((call) => `${call.name}:${call.argsJson}`)
    .sort()
    .join('\n')
}
