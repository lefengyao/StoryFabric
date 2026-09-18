import type { AgentEvent, ApprovalPolicy, ChatMessage, ChatSession, GoalRun, GoalTask, ModelSettings, OrchestrationRunRecord, PendingChange, RunAgentRequest, ToolCallData, UsageRecord } from '../../shared/types'
import { parseSkillCandidate, validateAgentQuestionAnswer, type AgentQuestionAnswer, type SkillCandidate, type SkillCandidateAction } from '../../shared/agentQuestions'
import { MAX_TOOL_ROUNDS } from '../../shared/types'
import type { LlmAdapter, LlmAdapterFactory, ModelParams } from '../llm/types'
import { CoreSessionStore, titleFromMessage } from '../workspace/sessionStore'
import type { FileStore } from '../storage/fileStore'
import type { GlobalSkillLibrary } from '../skills/globalSkillLibrary'
import { executeTool, TOOL_DEFS, type ToolOutcome } from '../tools/registry'
import { resolveModelSettings } from '../llm/modelCatalog'
import { SYSTEM_PROMPT } from './prompts'
import { validateMessageFiles } from '../attachments/validation'
import { profileForModel } from '../llm/modelCatalog'
import { normalizeApprovalPolicy, normalizeCreativePreferences, validateCreativePreferences } from '../../shared/creative'
import { builtinPackages } from '../skills/builtin'
import { ContentPackageStore } from '../skills/packageStore'
import type { ContentPackage } from '../skills/types'
import { ModelCallGateway } from './modelCallGateway'
import { OrchestrationScheduler } from '../orchestration/scheduler'
import type { StageId } from '../orchestration/types'
import { SubagentManager, type DelegateTaskInput } from '../orchestration/subagents'
import { RuleStore } from '../rules/ruleStore'
import { resolveRules } from '../rules/resolveRules'
import type { RuleLayer } from '../rules/types'
import { getChapterBody } from '../workspace/entityStore'
import { contentRevision } from '../workspace/resourceRevision'
import { ToolBodyPreview } from '../llm/toolPreview'
import { ApprovalAuditLog } from './approvalAudit'
import { classifyMutation, requiresApproval } from './approvalPolicy'
import { GoalStore } from '../goal/goalStore'
import { GoalRunner } from '../goal/goalRunner'
import { buildGoalPlanningPrompt, parseGoalPlan } from '../goal/goalPlanner'
import type { GoalValidationResult } from '../goal/goalTypes'
import { runToolLoop, type ToolLoopToolResult } from './toolLoop'
import { parseAskUserArguments, QUESTION_TOOL_DEFS } from './questionTool'
import { buildRoleSystemPrompt, toolsForRole } from '../orchestration/rolePrompts'
import { readOnlyToolDefs } from '../orchestration/toolPolicy'
import { WRITE_TOOLS } from '../tools/registry'
import { loadProjectContext, summarizeProjectContext } from '../orchestration/projectContext'
import type { RequestContextUsage, SourceRef, ToolReceipt } from '../../shared/agentEvidence'
import type { SkillApplicationEvent } from '../../shared/agentEvidence'
import { SkillResolver, type SkillSnapshot } from '../skills/skillResolver'
import { executeSkillTool, SKILL_TOOL_DEFS } from '../skills/skillTools'
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
  globalSkillLibrary?: GlobalSkillLibrary
}

interface Waiter { sessionId: string; resolve: (approved: boolean) => void }

interface QuestionWaiter {
  sessionId: string
  runId: string
  promise: Promise<AgentQuestionAnswer>
  resolve: (answer: AgentQuestionAnswer) => void
  reject: (error: Error) => void
}

interface PendingQuestion {
  question: import('../../shared/agentQuestions').AgentQuestion
  sessionId: string
  runId: string
  session: ChatSession
}

interface SkillCandidateWaiter {
  sessionId: string
  runId: string
  session: ChatSession
  candidate: SkillCandidate
  promise: Promise<SkillCandidateResolution>
  resolve: (result: SkillCandidateResolution) => void
  reject: (error: Error) => void
}

interface SkillCandidateResolution {
  action: SkillCandidateAction
  packageId?: string
  version?: string
  enabled?: boolean
}

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

function approvalGuidance(policy: ApprovalPolicy): string {
  if (policy === 'strict') return '当前权限：严格审批。任何新建、修改、移动、恢复和删除都必须等待用户批准。'
  if (policy === 'delete-confirm') return '当前权限：删除确认。新建、修改、移动和恢复可以直接执行；任何删除仍必须等待用户批准。'
  return '当前权限：自动执行。允许的工作区工具会直接执行，不弹出审批；仍需如实报告每次操作。'
}

function userTextForRequest(req: RunAgentRequest): string {
  if (!req.attachments?.length) return req.message
  const lines = req.attachments.map((a) => `[@${ATTACHMENT_LABEL[a.kind] ?? '实体'}：${a.label}，id=${a.id}]`)
  return `${req.message}\n\n${lines.join('\n')}\n（以上是用户显式引用的项目实体，请用工具按 id 查阅其内容）`
}

function creativeGuidance(creative: ReturnType<typeof normalizeCreativePreferences>, packages: ContentPackage[] = builtinPackages): string {
  const selectedSkillIds = new Set(creative.selectedSkillIds)
  const selectedRuleSetIds = new Set(creative.selectedRuleSetIds)
  const useAllEnabledSkills = selectedSkillIds.size === 0
  const useAllEnabledRuleSets = selectedRuleSetIds.size === 0
  return packages.flatMap((pkg) => {
    const skillSelected = useAllEnabledSkills || pkg.manifest.skills.some((skill) => selectedSkillIds.has(skill.id) || selectedSkillIds.has(pkg.manifest.id))
    const ruleSelected = useAllEnabledRuleSets || pkg.manifest.ruleSets.some((ruleSet) => selectedRuleSetIds.has(ruleSet.id) || selectedRuleSetIds.has(pkg.manifest.id))
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

function selectedRuleLayers(creative: ReturnType<typeof normalizeCreativePreferences>, packages: ContentPackage[]): RuleLayer[] {
  const selected = new Set(creative.selectedRuleSetIds)
  const useAllEnabledRuleSets = selected.size === 0
  return packages.flatMap((pkg) => pkg.manifest.ruleSets.flatMap((entry) => {
    if (!useAllEnabledRuleSets && !selected.has(entry.id) && !selected.has(pkg.manifest.id)) return []
    try {
      const parsed = JSON.parse(pkg.files.find((file) => file.path === entry.path)?.content ?? '{}') as { rules?: RuleLayer['rules'] }
      return parsed.rules ? [{ source: 'run' as const, rules: parsed.rules }] : []
    } catch {
      return []
    }
  }))
}

export class CoreAgentService {
  private aborts = new Map<string, AbortController>()
  private activeRunIds = new Map<string, string>()
  private pendingRunIds = new Map<string, string>()
  private waiters = new Map<string, Waiter>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private questionWaiters = new Map<string, QuestionWaiter>()
  private answeredQuestions = new Map<string, AgentQuestionAnswer>()
  private pendingSkillCandidates = new Map<string, SkillCandidateWaiter>()
  private answeredSkillCandidates = new Map<string, { action: SkillCandidateAction; packageId?: string; version?: string; enabled?: boolean }>()
  private skillResolutionInFlight = new Map<string, Promise<void>>()
  private skillResolutionActions = new Map<string, SkillCandidateAction>()

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
          maxAttempts: 2,
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

  async answerQuestion(answer: AgentQuestionAnswer): Promise<void> {
    const answered = this.answeredQuestions.get(answer.questionId)
    if (answered) {
      if (JSON.stringify(answered) === JSON.stringify(answer)) return
      throw new Error('问题已经回答，不能替换答案')
    }

    const pending = this.pendingQuestions.get(answer.questionId)
    if (!pending) {
      const persisted = await this.findPersistedQuestion(answer.questionId)
      if (persisted) throw new Error('问题存在，但当前进程没有可安全继续运行的等待点；请重新启动本次任务')
      throw new Error('问题不存在或已经结束')
    }
    validateAgentQuestionAnswer(pending.question, answer)
    const waiter = this.questionWaiters.get(answer.questionId)
    if (!waiter) throw new Error('问题等待器不存在，无法安全继续运行')
    const activePending = this.pendingQuestions.get(answer.questionId)
    const activeWaiter = this.questionWaiters.get(answer.questionId)
    if (activePending !== pending || activeWaiter !== waiter) {
      const alreadyAnswered = this.answeredQuestions.get(answer.questionId)
      if (alreadyAnswered && JSON.stringify(alreadyAnswered) === JSON.stringify(answer)) return
      throw new Error('问题已经由另一个回答请求处理')
    }

    this.answeredQuestions.set(answer.questionId, structuredClone(answer))
    this.pendingQuestions.delete(answer.questionId)
    this.questionWaiters.delete(answer.questionId)
    const previousSessionWaitingQuestion = pending.session.waitingQuestion
    const record = pending.session.orchestrationRuns?.find((item) => item.runId === pending.runId)
    const previousRecordWaitingQuestion = record?.waitingQuestion
    if (pending.session.waitingQuestion?.questionId === answer.questionId) delete pending.session.waitingQuestion
    if (record?.waitingQuestion?.questionId === answer.questionId) delete record.waitingQuestion
    try {
      await this.options.sessions.save(pending.session)
    } catch (error) {
      if (previousSessionWaitingQuestion) pending.session.waitingQuestion = previousSessionWaitingQuestion
      if (record && previousRecordWaitingQuestion) record.waitingQuestion = previousRecordWaitingQuestion
      this.pendingQuestions.set(answer.questionId, pending)
      this.questionWaiters.set(answer.questionId, waiter)
      this.answeredQuestions.delete(answer.questionId)
      throw error
    }
    waiter.resolve(answer)
  }

  async resolveSkillCandidate(candidateId: string, action: SkillCandidateAction): Promise<void> {
    const inFlight = this.skillResolutionInFlight.get(candidateId)
    if (inFlight) {
      if (this.skillResolutionActions.get(candidateId) !== action) throw new Error('技能候选已经由另一个请求处理')
      return inFlight
    }
    const operation = this.resolveSkillCandidateOnce(candidateId, action)
    this.skillResolutionActions.set(candidateId, action)
    this.skillResolutionInFlight.set(candidateId, operation)
    try {
      await operation
    } finally {
      if (this.skillResolutionInFlight.get(candidateId) === operation) this.skillResolutionInFlight.delete(candidateId)
      if (this.skillResolutionActions.get(candidateId) === action) this.skillResolutionActions.delete(candidateId)
    }
  }

  private async resolveSkillCandidateOnce(candidateId: string, action: SkillCandidateAction): Promise<void> {
    const answered = this.answeredSkillCandidates.get(candidateId)
    if (answered) {
      if (answered.action === action) return
      throw new Error('技能候选已经处理，不能替换决定')
    }
    if (action !== 'install-enable' && action !== 'install' && action !== 'reject') throw new Error('技能候选操作无效')
    const waiter = this.pendingSkillCandidates.get(candidateId)
    if (!waiter) {
      const persisted = await this.findPersistedSkillCandidate(candidateId)
      if (persisted) throw new Error('技能候选存在，但当前进程没有可安全继续运行的等待点；请重新启动本次任务')
      throw new Error('技能候选不存在或已经结束')
    }
    if (this.pendingSkillCandidates.get(candidateId) !== waiter) throw new Error('技能候选已经由另一个请求处理')
    this.pendingSkillCandidates.delete(candidateId)

    let resolution: SkillCandidateResolution = { action }
    try {
      if (action !== 'reject') {
        if (!this.options.globalSkillLibrary) throw new Error('当前平台没有可用的全局 Skill 库')
        const installed = await this.options.globalSkillLibrary.install(waiter.candidate.package, action === 'install-enable')
        resolution = { action, packageId: installed.manifest.id, version: installed.manifest.version, enabled: installed.enabled }
      }

      const sessionCandidate = waiter.session.skillCandidates?.find((candidate) => candidate.candidateId === candidateId)
      if (sessionCandidate) sessionCandidate.status = action === 'reject' ? 'rejected' : 'accepted'
      const record = waiter.session.orchestrationRuns?.find((item) => item.runId === waiter.runId)
      const recordCandidate = record?.skillCandidates?.find((candidate) => candidate.candidateId === candidateId)
      if (recordCandidate) recordCandidate.status = sessionCandidate?.status ?? (action === 'reject' ? 'rejected' : 'accepted')
      await this.options.sessions.save(waiter.session)
      this.answeredSkillCandidates.set(candidateId, resolution)
      waiter.resolve(resolution)
    } catch (error) {
      this.pendingSkillCandidates.set(candidateId, waiter)
      throw error
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
    for (const [questionId, waiter] of this.questionWaiters) {
      if (waiter.sessionId !== sessionId) continue
      this.questionWaiters.delete(questionId)
      const error = new Error('已中止本次生成。')
      error.name = 'AbortError'
      waiter.reject(error)
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

  private async findPersistedQuestion(questionId: string): Promise<{ session: ChatSession; question: import('../../shared/agentQuestions').AgentQuestion } | null> {
    for (const meta of await this.options.sessions.list()) {
      const session = await this.options.sessions.load(meta.id)
      if (!session) continue
      if (session.waitingQuestion?.questionId === questionId) return { session, question: session.waitingQuestion }
      const record = session.orchestrationRuns?.find((item) => item.waitingQuestion?.questionId === questionId)
      if (record?.waitingQuestion) return { session, question: record.waitingQuestion }
    }
    return null
  }

  private async findPersistedSkillCandidate(candidateId: string): Promise<{ session: ChatSession; candidate: SkillCandidate } | null> {
    for (const meta of await this.options.sessions.list()) {
      const session = await this.options.sessions.load(meta.id)
      const candidate = session?.skillCandidates?.find((item) => item.candidateId === candidateId)
      if (session && candidate) return { session, candidate }
      const recordCandidate = session?.orchestrationRuns?.flatMap((item) => item.skillCandidates ?? []).find((item) => item.candidateId === candidateId)
      if (session && recordCandidate) return { session, candidate: recordCandidate }
    }
    return null
  }

  private async openQuestion(input: {
    argsJson: string
    runId: string
    sessionId: string
    stageId?: string
    agentId: string
    session: ChatSession
  }): Promise<import('../../shared/agentQuestions').AgentQuestion> {
    const question = parseAskUserArguments(input.argsJson, {
      runId: input.runId,
      sessionId: input.sessionId,
      ...(input.stageId ? { stageId: input.stageId } : {}),
      agentId: input.agentId
    })
    let resolve!: (answer: AgentQuestionAnswer) => void
    let reject!: (error: Error) => void
    const promise = new Promise<AgentQuestionAnswer>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    void promise.catch(() => {})
    this.pendingQuestions.set(question.questionId, { question, sessionId: input.sessionId, runId: input.runId, session: input.session })
    this.questionWaiters.set(question.questionId, { sessionId: input.sessionId, runId: input.runId, promise, resolve, reject })
    input.session.waitingQuestion = question
    const record = input.session.orchestrationRuns?.find((item) => item.runId === input.runId)
    if (record) {
      record.waitingQuestion = question
      record.currentStage = input.stageId
      record.stages = [{ stageId: input.stageId ?? 'basic', status: 'waiting_user' }]
      record.updatedAt = Date.now()
    }
    try {
      await this.options.sessions.save(input.session)
    } catch (error) {
      this.pendingQuestions.delete(question.questionId)
      this.questionWaiters.delete(question.questionId)
      if (input.session.waitingQuestion?.questionId === question.questionId) delete input.session.waitingQuestion
      if (record?.waitingQuestion?.questionId === question.questionId) delete record.waitingQuestion
      throw error
    }
    this.emit(input.sessionId, { type: 'agent-question', question }, input.runId)
    this.emit(input.sessionId, { type: 'waiting-user', questionId: question.questionId }, input.runId)
    return question
  }

  private async openSkillCandidate(input: {
    package: ContentPackage
    reason: string
    runId: string
    sessionId: string
    stageId: string
    agentId: string
    session: ChatSession
  }): Promise<SkillCandidate> {
    const candidate = parseSkillCandidate({
      candidateId: `candidate_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      runId: input.runId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      package: input.package,
      reason: input.reason,
      status: 'pending'
    })
    let resolve!: (result: SkillCandidateResolution) => void
    let reject!: (error: Error) => void
    const promise = new Promise<SkillCandidateResolution>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    void promise.catch(() => {})
    const waiter: SkillCandidateWaiter = { sessionId: input.sessionId, runId: input.runId, session: input.session, candidate, promise, resolve, reject }
    this.pendingSkillCandidates.set(candidate.candidateId, waiter)
    input.session.skillCandidates = [...(input.session.skillCandidates ?? []).filter((item) => item.candidateId !== candidate.candidateId), candidate].slice(-20)
    const record = input.session.orchestrationRuns?.find((item) => item.runId === input.runId)
    if (record) {
      record.skillCandidates = [...(record.skillCandidates ?? []).filter((item) => item.candidateId !== candidate.candidateId), candidate]
      record.updatedAt = Date.now()
    }
    try {
      await this.options.sessions.save(input.session)
    } catch (error) {
      this.pendingSkillCandidates.delete(candidate.candidateId)
      throw error
    }
    this.emit(input.sessionId, { type: 'skill-candidate', candidate }, input.runId)
    this.emit(input.sessionId, { type: 'waiting-user', candidateId: candidate.candidateId, reason: 'skill-candidate' }, input.runId)
    return candidate
  }

  private waitForQuestion(questionId: string, signal: AbortSignal): Promise<AgentQuestionAnswer> {
    const answered = this.answeredQuestions.get(questionId)
    if (answered) return Promise.resolve(structuredClone(answered))
    const waiter = this.questionWaiters.get(questionId)
    if (!waiter) return Promise.reject(new Error('问题等待器不存在，无法安全继续运行'))
    if (signal.aborted) {
      const error = new Error('已中止本次生成。')
      error.name = 'AbortError'
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        reject(Object.assign(new Error('已中止本次生成。'), { name: 'AbortError' }))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      waiter.promise.then(
        (answer) => { signal.removeEventListener('abort', onAbort); resolve(answer) },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error) }
      )
    })
  }

  private waitForSkillCandidate(candidateId: string, signal: AbortSignal): Promise<SkillCandidateResolution> {
    const answered = this.answeredSkillCandidates.get(candidateId)
    if (answered) return Promise.resolve(structuredClone(answered))
    const waiter = this.pendingSkillCandidates.get(candidateId)
    if (!waiter) return Promise.reject(new Error('技能候选等待器不存在，无法安全继续运行'))
    if (signal.aborted) {
      const error = new Error('已中止本次生成。')
      error.name = 'AbortError'
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        reject(Object.assign(new Error('已中止本次生成。'), { name: 'AbortError' }))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      waiter.promise.then(
        (result) => { signal.removeEventListener('abort', onAbort); resolve(result) },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error) }
      )
    })
  }

  private async clearQuestionsForRun(runId: string, session: ChatSession): Promise<void> {
    for (const [questionId, pending] of this.pendingQuestions) {
      if (pending.runId !== runId) continue
      this.pendingQuestions.delete(questionId)
      const waiter = this.questionWaiters.get(questionId)
      this.questionWaiters.delete(questionId)
      if (waiter) waiter.reject(new Error('运行已结束，问题不再等待回答'))
      if (session.waitingQuestion?.questionId === questionId) delete session.waitingQuestion
      const record = session.orchestrationRuns?.find((item) => item.runId === runId)
      if (record?.waitingQuestion?.questionId === questionId) delete record.waitingQuestion
    }
    for (const [candidateId, waiter] of this.pendingSkillCandidates) {
      if (waiter.runId !== runId) continue
      this.pendingSkillCandidates.delete(candidateId)
      if (session.skillCandidates) session.skillCandidates = session.skillCandidates.filter((candidate) => candidate.candidateId !== candidateId)
      const record = session.orchestrationRuns?.find((item) => item.runId === runId)
      if (record?.skillCandidates) record.skillCandidates = record.skillCandidates.filter((candidate) => candidate.candidateId !== candidateId)
      waiter.reject(new Error('运行已结束，技能候选不再等待确认'))
    }
  }

  private async runGoalTaskCall(options: {
    runId: string
    sessionId: string
    goal: GoalRun
    task: GoalTask
    session: ChatSession
    systemPrompt: string
    adapter: LlmAdapter
    apiKey: string
    providerId: string
    providerName: string
    model: string
    modelSettings: ModelParams
    signal: AbortSignal
    gateway: ModelCallGateway
    approvalPolicy: ApprovalPolicy
    approvalAudit: ApprovalAuditLog
    saveGoal?: (goal: GoalRun) => Promise<void>
  }): Promise<string> {
    const messageId = `${options.runId}_goal_task_${options.task.id}_${options.task.attempts}`
    let partial = ''
    const toolArgBuffers = new Map<string, string>()
    const result = await options.gateway.call({
      callId: `${options.runId}:goal-task:${options.task.id}:${options.task.attempts}`,
      runId: options.runId,
      agentId: 'goal-task',
      stageId: options.task.id,
      purpose: 'goal-task',
      providerId: options.providerId,
      providerName: options.providerName,
      model: options.model,
      estimatedInputTokens: Math.max(1, estimateTextTokens(options.systemPrompt) + estimateTextTokens(options.task.instructions)),
      maxOutputTokens: options.modelSettings.maxOutputTokens,
      maxAttempts: 2,
      execute: () => options.adapter.stream(options.model, {
        system: `${options.systemPrompt}\n\n【目标任务】\n${options.task.title}\n${options.task.instructions}\n\n【验收标准】\n${options.task.acceptanceCriteria.join('\n')}`,
        messages: [{ id: messageId, role: 'user', text: options.task.instructions }],
        tools: TOOL_DEFS,
        signal: options.signal,
        params: options.modelSettings
      }, options.apiKey, {
        onText: (delta) => {
          partial += delta
          this.emit(options.sessionId, { type: 'text-delta', messageId, delta }, options.runId)
        },
        onToolCallStart: (callId, name) => {
          this.emit(options.sessionId, { type: 'tool-start', callId, name, argsJson: toolArgBuffers.get(callId) ?? '' }, options.runId)
        },
        onToolArgsDelta: (callId, delta) => {
          toolArgBuffers.set(callId, `${toolArgBuffers.get(callId) ?? ''}${delta}`)
          this.emit(options.sessionId, { type: 'tool-args-delta', callId, delta }, options.runId)
        },
        onToolCallComplete: (callId, _name, argsJson) => { toolArgBuffers.set(callId, argsJson) }
      })
    })
    this.emit(options.sessionId, { type: 'budget', snapshot: options.gateway.budget.snapshot(), goalId: options.goal.id }, options.runId)
    if (result.text || partial) options.session.messages.push({ id: messageId, role: 'assistant', text: result.text || partial || undefined, toolCalls: result.toolCalls.length ? result.toolCalls : undefined, thinkingBlocks: result.thinkingBlocks })
    for (const toolCall of result.toolCalls) {
      this.emit(options.sessionId, { type: 'tool-start', callId: toolCall.id, name: toolCall.name, argsJson: toolCall.argsJson }, options.runId)
      const outcome = await (this.options.executeTool?.(toolCall.name, toolCall.argsJson) ?? executeTool(this.options.store, toolCall.name, toolCall.argsJson))
      if (outcome.kind === 'result') {
        this.emit(options.sessionId, { type: 'tool-done', callId: toolCall.id, ok: outcome.ok, resultPreview: outcome.preview }, options.runId)
        options.session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text: outcome.text, isError: !outcome.ok })
        continue
      }
      const mutationKind = classifyMutation(outcome.change.toolName)
      const change: PendingChange = { ...outcome.change, ...(mutationKind ? { mutationKind } : {}), goalId: options.goal.id, goalTaskId: options.task.id }
      const auditId = await options.approvalAudit.request({ runId: options.runId, goalId: options.goal.id, taskId: options.task.id, toolName: change.toolName, mutationKind: mutationKind ?? undefined, argsJson: toolCall.argsJson, policy: options.approvalPolicy })
      const needsApproval = requiresApproval(options.approvalPolicy, change.toolName)
      let approved = true
      if (needsApproval) {
        options.goal.status = 'awaiting-approval'
        options.task.status = 'awaiting-approval'
        this.emit(options.sessionId, { type: 'goal-task', goalId: options.goal.id, task: structuredClone(options.task) }, options.runId)
        if (options.saveGoal) await options.saveGoal(options.goal)
        this.emit(options.sessionId, { type: 'pending-change', change }, options.runId)
        approved = await this.waitConfirm(change, options.sessionId, options.signal)
        if (!options.goal.status || options.goal.status === 'awaiting-approval') options.goal.status = 'running'
        if (options.task.status === 'awaiting-approval') {
          options.task.status = 'running'
          this.emit(options.sessionId, { type: 'goal-task', goalId: options.goal.id, task: structuredClone(options.task) }, options.runId)
        }
        if (options.saveGoal) await options.saveGoal(options.goal)
      }
      let ok = approved
      let text = approved ? '' : '用户拒绝了此变更。请勿原样重复提交。'
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
      if (!text) text = '变更已写入'
      await options.approvalAudit.resolve(auditId, { decision: options.signal.aborted ? 'invalidated' : approved ? 'approved' : 'rejected', result: options.signal.aborted ? 'invalidated' : status, resultSummary: text })
      this.emit(options.sessionId, { type: 'change-result', changeId: change.id, status, message: text }, options.runId)
      this.emit(options.sessionId, { type: 'tool-done', callId: toolCall.id, ok, resultPreview: ok ? '变更已写入' : approved ? '写入失败' : '用户已拒绝' }, options.runId)
      options.session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text, isError: !ok })
    }
    return result.text?.trim() || partial.trim() || (result.toolCalls.length ? `已完成 ${result.toolCalls.length} 项工具操作。` : '任务已完成。')
  }

  private async runGoalMode(options: {
    req: RunAgentRequest
    runId: string
    sessionId: string
    session: ChatSession
    message: string
    prompt: string
    provider: AgentSettings['providers'][number]
    adapter: LlmAdapter
    effectiveSettings: ModelParams
    gateway: ModelCallGateway
    signal: AbortSignal
    approvalPolicy: ApprovalPolicy
    approvalAudit: ApprovalAuditLog
    context: string
  }): Promise<{ goalId: string; status: GoalRun['status']; planVersion: number }> {
    const workspaceId = this.options.workspaceId ?? 'workspace'
    const store = new GoalStore(this.options.store)
    let goal = options.req.goalRunId
      ? await store.assertWorkspace(options.req.goalRunId, workspaceId)
      : await store.create({ workspaceId, sessionId: options.sessionId, goal: options.message, approvalPolicy: options.approvalPolicy })
    const runner = new GoalRunner({
      plan: async (current, signal) => {
        const planningPrompt = buildGoalPlanningPrompt(current.goal, options.context)
        const messageId = `${options.runId}_goal_plan`
        let partial = ''
        const result = await options.gateway.call({
          callId: `${options.runId}:goal-plan:${current.planVersion}`,
          runId: options.runId,
          agentId: 'goal-planner',
          purpose: 'goal-plan',
          providerId: options.provider.id,
          providerName: options.provider.name ?? options.provider.id,
          model: options.req.model,
          estimatedInputTokens: Math.max(1, estimateTextTokens(options.prompt) + estimateTextTokens(planningPrompt)),
          maxOutputTokens: Math.min(options.effectiveSettings.maxOutputTokens, 4096),
          maxAttempts: 2,
          execute: () => options.adapter.stream(options.req.model, { system: options.prompt, messages: [{ id: messageId, role: 'user', text: planningPrompt }], tools: [], signal, params: { ...options.effectiveSettings, maxOutputTokens: Math.min(options.effectiveSettings.maxOutputTokens, 4096) } }, options.provider.apiKey, { onText: (delta) => { partial += delta; this.emit(options.sessionId, { type: 'text-delta', messageId, delta }, options.runId) } })
        })
        this.emit(options.sessionId, { type: 'budget', snapshot: options.gateway.budget.snapshot(), goalId: current.id }, options.runId)
        return parseGoalPlan(result.text || partial)
      },
      execute: async (current, task, signal) => ({ summary: await this.runGoalTaskCall({ runId: options.runId, sessionId: options.sessionId, goal: current, task, session: options.session, systemPrompt: options.prompt, adapter: options.adapter, apiKey: options.provider.apiKey, providerId: options.provider.id, providerName: options.provider.name ?? options.provider.id, model: options.req.model, modelSettings: options.effectiveSettings, signal, gateway: options.gateway, approvalPolicy: options.approvalPolicy, approvalAudit: options.approvalAudit, saveGoal: (snapshot) => store.save(snapshot) }) }),
      validate: async (current, task, signal): Promise<GoalValidationResult> => {
        const prompt = `请只检查以下目标任务是否达到验收标准，输出 JSON：{"passed":true或false,"reason":"简短理由"}\n任务：${task.title}\n结果：${task.resultSummary ?? ''}\n验收标准：${task.acceptanceCriteria.join('；')}`
        const messageId = `${options.runId}_goal_validation_${task.id}_${task.attempts}`
        let partial = ''
        const result = await options.gateway.call({
          callId: `${options.runId}:goal-validation:${task.id}:${task.attempts}`,
          runId: options.runId,
          agentId: 'goal-validator',
          stageId: task.id,
          purpose: 'goal-validation',
          providerId: options.provider.id,
          providerName: options.provider.name ?? options.provider.id,
          model: options.req.model,
          estimatedInputTokens: Math.max(1, estimateTextTokens(options.prompt) + estimateTextTokens(prompt)),
          maxOutputTokens: Math.min(options.effectiveSettings.maxOutputTokens, 1024),
          maxAttempts: 2,
          execute: () => options.adapter.stream(options.req.model, { system: options.prompt, messages: [{ id: messageId, role: 'user', text: prompt }], tools: [], signal, params: { ...options.effectiveSettings, maxOutputTokens: Math.min(options.effectiveSettings.maxOutputTokens, 1024) } }, options.provider.apiKey, { onText: (delta) => { partial += delta; this.emit(options.sessionId, { type: 'text-delta', messageId, delta }, options.runId) } })
        })
        this.emit(options.sessionId, { type: 'budget', snapshot: options.gateway.budget.snapshot(), goalId: current.id }, options.runId)
        const text = result.text || partial
        try {
          const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()) as { passed?: unknown; reason?: unknown }
          return { passed: parsed.passed === true, reason: typeof parsed.reason === 'string' ? parsed.reason : '验收模型未提供理由' }
        } catch {
          const failed = /不通过|失败|未达到|false/i.test(text)
          return { passed: !failed && Boolean(text.trim()), reason: text.trim() || '验收模型没有返回结果' }
        }
      },
      save: (snapshot) => store.save(snapshot),
      emit: (event) => {
        if (event.type === 'goal-plan' && event.goal) this.emit(options.sessionId, { type: 'goal-plan', goal: event.goal }, options.runId)
        if (event.type === 'goal-task' && event.task) this.emit(options.sessionId, { type: 'goal-task', goalId: event.goalId, task: event.task }, options.runId)
        if (event.type === 'goal-validation' && event.validation) this.emit(options.sessionId, { type: 'goal-validation', goalId: event.goalId, taskId: event.taskId ?? '', passed: event.validation.passed, reason: event.validation.reason }, options.runId)
      }
    })
    if (options.req.goalAction === 'replan') goal = await runner.replan(goal)
    else goal = goal.status === 'cancelled' || goal.status === 'needs-attention' || goal.status === 'awaiting-approval' ? await runner.resume(goal) : await runner.start(goal)
    return { goalId: goal.id, status: goal.status, planVersion: goal.planVersion }
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
    modelSettings: ModelParams
    providers: AgentSettings['providers']
    history: string
    originalText: string
    sourceRevision: string | number
    stageRuleGuidance: (stageId: string) => string
    signal: AbortSignal
    session: ChatSession
    gateway: ModelCallGateway
    skillSnapshot?: SkillSnapshot
    sourceRefs?: SourceRef[]
    approvalPolicy: ApprovalPolicy
    approvalAudit: ApprovalAuditLog
  }): Promise<void> {
    const orchestration = options.creative.orchestration
    const maxEstimatedTokens = orchestration?.maxEstimatedTokens ?? 100000
    if (Array.isArray(orchestration?.enabledStageIds) && orchestration.enabledStageIds.length === 0) throw new Error('请至少选择一个编排阶段')
    const gateway = options.gateway
    const system = options.prompt
    const stagePartials = new Map<string, string>()
    const toolReceipts: ToolReceipt[] = []
    const requestContexts: RequestContextUsage[] = []
    const skillEvents: SkillApplicationEvent[] = []
    const skillResolver = this.options.globalSkillLibrary && options.skillSnapshot ? new SkillResolver(this.options.globalSkillLibrary) : undefined
    const initialRecord: OrchestrationRunRecord = {
      runId: options.runId,
      status: 'running',
      sourceRevision: options.sourceRevision,
      originalText: options.originalText,
      stages: [],
      artifacts: [],
      overlay: {},
      businessText: options.originalText,
      updatedAt: Date.now()
    }
    options.session.orchestrationRuns = [...(options.session.orchestrationRuns ?? []).filter((record) => record.runId !== options.runId), initialRecord].slice(-10)
    await this.options.sessions.save(options.session).catch(() => {})
    const sourcesForTool = (toolCall: ToolCallData): SourceRef[] => {
      const sources = options.sourceRefs ?? []
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(toolCall.argsJson || '{}') as Record<string, unknown> } catch { return [] }
      const requestedId = typeof args.chapterId === 'string' ? args.chapterId : typeof args.characterId === 'string' ? args.characterId : typeof args.settingId === 'string' ? args.settingId : typeof args.outlineId === 'string' ? args.outlineId : typeof args.noteId === 'string' ? args.noteId : undefined
      if (requestedId) return sources.filter((source) => source.entityId === requestedId)
      if (toolCall.name.includes('character') || toolCall.name.includes('relation')) return sources.filter((source) => source.sourcePath.startsWith('characters/') || source.sourcePath.startsWith('relationships'))
      if (toolCall.name.includes('event')) return sources.filter((source) => source.sourcePath.startsWith('events/'))
      if (toolCall.name.includes('setting')) return sources.filter((source) => source.sourcePath.startsWith('settings/'))
      if (toolCall.name.includes('chapter') || toolCall.name.includes('volume')) return sources.filter((source) => source.sourcePath.startsWith('chapters/'))
      if (toolCall.name.includes('outline')) return sources.filter((source) => source.sourcePath.startsWith('outline/'))
      if (toolCall.name === 'search_project' || toolCall.name === 'lookup_term') return sources
      return []
    }
    const resolveStageRuntime = (stageId: string) => {
      const assigned = orchestration?.modelByStage[stageId]
      if (orchestration?.mode === 'single') {
        return {
          provider: undefined,
          model: options.model,
          apiKey: options.apiKey,
          adapter: options.adapter,
          settings: options.modelSettings
        }
      }
      const assignedProvider = assigned ? options.providers.find((provider) => provider.id === assigned.providerId) : undefined
      if (assigned && !assignedProvider) throw new Error(`阶段 ${stageId} 配置的供应商不可用`)
      const provider = assignedProvider
      const model = assigned?.model ?? options.model
      const apiKey = provider?.apiKey ?? options.apiKey
      if (!apiKey) throw new Error(`阶段 ${stageId} 配置的供应商没有 API Key`)
      return {
        provider,
        model,
        apiKey,
        adapter: provider ? this.options.getAdapter(provider.protocol, provider.baseUrl) : options.adapter,
        settings: provider ? resolveModelSettings(provider, model) : options.modelSettings
      }
    }
    const subagentFindings: Array<{ role: string; text: string }> = []

    if (orchestration?.subagentsEnabled && orchestration.mode !== 'single') {
      const manager = new SubagentManager({
        workspaceId: this.options.workspaceId ?? 'workspace',
        maxChildren: 2,
        maxConcurrent: 1,
        runTask: async (input, childSignal) => {
          const roleStageId = input.role === 'style' ? 'anti-ai' : 'review'
          const runtime = resolveStageRuntime(roleStageId)
          const messageId = `${options.runId}_child_${input.role}`
          const stageId = `subagent:${input.role}`
          const sourceManifest = (options.sourceRefs ?? []).map((source) => `${source.sourcePath}@${source.revision}`).join('、')
          const taskPrompt = [
            `你是编排中的只读子智能体，负责${input.role === 'style' ? '文风、对白和冗余' : '人物、设定和连续性'}核对。`,
            '你可以调用当前工作区的只读资料工具查看人物、章节、章纲、设定、事件和项目文档，也可以调用 Skill 工具读取当前运行的 Skill。先读取证据，再输出简洁、可执行的建议；不得写入项目。',
            sourceManifest ? `本次运行的来源清单（仍须用工具复核）：${sourceManifest}` : '本次运行暂未预装来源清单；请先用项目工具查找资料。',
            `用户目标：${options.message}`,
            options.history ? `既有上下文：\n${options.history}` : ''
          ].filter(Boolean).join('\n\n')
          this.emit(options.sessionId, { type: 'stage-start', stageId }, options.runId)
          const tools = [...readOnlyToolDefs(input.requestedTools), ...SKILL_TOOL_DEFS]
          const messages: ChatMessage[] = [{ id: messageId, role: 'user', text: taskPrompt }]
          let messageSequence = 0
          try {
            const loopResult = await runToolLoop({
              getMessages: () => messages,
              appendMessage: (message) => messages.push(message),
              maxRounds: Math.min(MAX_TOOL_ROUNDS, 4),
              createMessageId: (kind) => `${options.runId}_child_${input.role}_${kind}_${++messageSequence}`,
              callModel: async ({ round, messageId: currentMessageId, messages: currentMessages }) => {
                const estimatedInputTokens = Math.max(1, estimateTextTokens(system) + estimateTextTokens(taskPrompt) + currentMessages.reduce((sum, item) => sum + estimateTextTokens(item.text), 0) + estimateTextTokens(JSON.stringify(tools)))
                const maxOutputTokens = Math.max(1, Math.min(runtime.settings.maxOutputTokens, input.tokenCap ?? 1200, maxEstimatedTokens - estimatedInputTokens))
                const result = await gateway.call({
                  callId: `${options.runId}:child:${input.role}:${round}`,
                  runId: options.runId,
                  stageId,
                  agentId: stageId,
                  parentAgentId: 'orchestration',
                  purpose: 'child',
                  providerId: runtime.provider?.id ?? options.providerId,
                  providerName: runtime.provider?.name ?? runtime.provider?.id ?? options.providerName,
                  model: runtime.model,
                  estimatedInputTokens,
                  maxOutputTokens,
                  maxAttempts: 2,
                  execute: () => runtime.adapter.stream(runtime.model, {
                    system: `${system}${options.stageRuleGuidance(roleStageId) ? `\n\n【当前阶段规则】\n${options.stageRuleGuidance(roleStageId)}` : ''}`,
                    messages: currentMessages,
                    tools,
                    signal: childSignal,
                    params: { ...runtime.settings, maxOutputTokens }
                  }, runtime.apiKey, {
                    onText: (delta) => this.emit(options.sessionId, { type: 'text-delta', messageId: currentMessageId, delta }, options.runId),
                    onToolCallStart: (callId, name) => this.emit(options.sessionId, { type: 'tool-start', callId, name, argsJson: '' }, options.runId),
                    onToolArgsDelta: (callId, delta) => this.emit(options.sessionId, { type: 'tool-args-delta', callId, delta }, options.runId),
                    onToolCallComplete: (callId, name, argsJson) => this.emit(options.sessionId, { type: 'tool-start', callId, name, argsJson }, options.runId)
                  })
                })
                this.emit(options.sessionId, { type: 'budget', snapshot: gateway.budget.snapshot() }, options.runId)
                return result
              },
              executeTool: async (toolCall) => {
                if (!tools.some((tool) => tool.name === toolCall.name)) return { ok: false, text: `子智能体没有权限调用工具：${toolCall.name}`, preview: '角色权限拒绝' }
                if (SKILL_TOOL_DEFS.some((tool) => tool.name === toolCall.name)) {
                  if (toolCall.name === 'propose_skill_package') {
                    return { ok: false, text: '只读子智能体不能提出需要用户审批的 Skill 安装候选。', preview: '子智能体不能发起 Skill 审批' }
                  }
                  const result = this.options.globalSkillLibrary && options.skillSnapshot
                    ? await executeSkillTool(this.options.globalSkillLibrary, toolCall.name, toolCall.argsJson, options.skillSnapshot)
                    : { ok: false, text: '当前运行没有全局 Skill 库', preview: 'Skill 库不可用' }
                  const receipt: ToolReceipt = {
                    runId: options.runId,
                    stageId,
                    agentId: stageId,
                    callId: toolCall.id,
                    toolName: toolCall.name,
                    status: result.ok ? 'read' : 'failed',
                    sources: []
                  }
                  toolReceipts.push(receipt)
                  this.emit(options.sessionId, { type: 'tool-receipt', receipt }, options.runId)
                  return result
                }
                const outcome = await (this.options.executeTool?.(toolCall.name, toolCall.argsJson) ?? executeTool(this.options.store, toolCall.name, toolCall.argsJson))
                const receipt: ToolReceipt = {
                  runId: options.runId,
                  stageId,
                  agentId: stageId,
                  callId: toolCall.id,
                  toolName: toolCall.name,
                  status: outcome.kind === 'pending' ? 'rejected' : outcome.ok ? 'read' : 'failed',
                  sources: sourcesForTool(toolCall)
                }
                toolReceipts.push(receipt)
                this.emit(options.sessionId, { type: 'tool-receipt', receipt }, options.runId)
                if (outcome.kind === 'pending') return { ok: false, text: '子智能体不能写入项目。', preview: '只读角色拒绝写入' }
                return { ok: outcome.ok, text: outcome.text, preview: outcome.preview }
              },
              onToolStart: (toolCall) => this.emit(options.sessionId, { type: 'tool-start', callId: toolCall.id, name: toolCall.name, argsJson: toolCall.argsJson }, options.runId),
              onToolDone: (toolCall, result) => this.emit(options.sessionId, { type: 'tool-done', callId: toolCall.id, ok: result.ok, resultPreview: result.preview }, options.runId)
            })
            this.emit(options.sessionId, { type: 'stage-complete', stageId }, options.runId)
            return { text: loopResult.text }
          } catch (error) {
            this.emit(options.sessionId, { type: 'error', message: `子智能体 ${input.role} 失败：${error instanceof Error ? error.message : String(error)}` }, options.runId)
            throw error
          }
        }
      })
      const cancelChildren = () => {
        for (const child of manager.list()) manager.cancel(child.id)
      }
      options.signal.addEventListener('abort', cancelChildren, { once: true })
      try {
        const sourceRefs = (options.sourceRefs ?? []).filter((source): source is SourceRef & { entityId: string } => Boolean(source.entityId)).map((source) => ({
          workspaceId: source.workspaceId,
          id: source.entityId,
          revision: source.revision,
          sourcePath: source.sourcePath
        }))
        const tasks: DelegateTaskInput[] = [
          { task: '核对人物、设定与情节连续性', role: 'continuity', depth: 1, sourceRefs, requestedTools: [], tokenCap: 1200 },
          { task: '核对文风、对白与冗余风险', role: 'style', depth: 1, sourceRefs, requestedTools: [], tokenCap: 1200 }
        ]
        for (const task of tasks) {
          if (options.signal.aborted) break
          await manager.delegate(task)
        }
        await manager.waitForIdle()
      } finally {
        options.signal.removeEventListener('abort', cancelChildren)
      }
      if (options.signal.aborted) {
        const error = new Error('cancelled')
        error.name = 'AbortError'
        throw error
      }
      for (const child of manager.list()) {
        if (child.status === 'completed' && child.result?.text.trim()) subagentFindings.push({ role: child.input.role, text: child.result.text })
      }
    }
    const scheduler = new OrchestrationScheduler({
      onStageComplete: (stageId) => this.emit(options.sessionId, { type: 'stage-complete', stageId }, options.runId),
      call: async ({ stageId, prompt, planningGate }) => {
        this.emit(options.sessionId, { type: 'stage-start', stageId }, options.runId)
        const runtime = resolveStageRuntime(stageId)
        const stageSkills = skillResolver
          ? await skillResolver.resolve({
            runId: options.runId,
            stageId,
            agentId: stageId,
            query: options.message,
            selectedSkillIds: options.creative.selectedSkillIds,
            snapshot: options.skillSnapshot!,
            emit: (event) => {
              skillEvents.push(event)
              this.emit(options.sessionId, { type: 'skill-activity', activity: event }, options.runId)
            }
          })
          : { skills: [], prompt: '', events: [] }
        const roleSystem = buildRoleSystemPrompt({ basePrompt: system, role: stageId, rules: options.stageRuleGuidance(stageId), skills: stageSkills.prompt })
        const tools = [...toolsForRole(stageId), ...QUESTION_TOOL_DEFS, ...SKILL_TOOL_DEFS]
        const stageMessages: ChatMessage[] = [{ id: `${options.runId}_${stageId}_input`, role: 'user', text: prompt }]
        let receiptCount = 0
        let messageSequence = 0
        const executeStageTool = async (toolCall: ToolCallData): Promise<ToolLoopToolResult> => {
          if (stageId === 'write' && !planningGate.open) {
            return { ok: false, text: `正文写作门禁未开启，缺少：${planningGate.missing.join('、')}`, preview: '正文写作被规划门禁阻止' }
          }
          if (!tools.some((tool) => tool.name === toolCall.name) || (WRITE_TOOLS.has(toolCall.name) && stageId !== 'write')) {
            return { ok: false, text: `角色 ${stageId} 没有权限调用工具：${toolCall.name}`, preview: '角色权限拒绝' }
          }
          if (toolCall.name === 'ask_user') {
            const question = await this.openQuestion({
              argsJson: toolCall.argsJson,
              runId: options.runId,
              sessionId: options.sessionId,
              stageId,
              agentId: stageId,
              session: options.session
            })
            return { ok: true, text: '', preview: '等待用户回答', waitingUser: question }
          }
          if (SKILL_TOOL_DEFS.some((tool) => tool.name === toolCall.name)) {
            const skillResult = this.options.globalSkillLibrary && options.skillSnapshot
              ? await executeSkillTool(this.options.globalSkillLibrary, toolCall.name, toolCall.argsJson, options.skillSnapshot)
              : { ok: false, text: '当前运行没有全局 Skill 库', preview: 'Skill 库不可用' }
            receiptCount += 1
            if (toolCall.name === 'propose_skill_package' && skillResult.ok && skillResult.candidatePackage) {
              const candidate = await this.openSkillCandidate({
                package: skillResult.candidatePackage,
                reason: skillResult.candidateReason ?? '智能体建议该 Skill 用于当前任务',
                runId: options.runId,
                sessionId: options.sessionId,
                stageId,
                agentId: stageId,
                session: options.session
              })
              return { ok: true, text: '', preview: '等待确认安装 Skill', waitingCandidate: candidate }
            }
            const receipt: ToolReceipt = {
              runId: options.runId,
              stageId,
              agentId: stageId,
              callId: toolCall.id,
              toolName: toolCall.name,
              status: skillResult.ok ? 'read' : 'failed',
              sources: []
            }
            toolReceipts.push(receipt)
            this.emit(options.sessionId, { type: 'tool-receipt', receipt }, options.runId)
            return { ok: skillResult.ok, text: skillResult.text, preview: skillResult.preview }
          }
          const outcome = await (this.options.executeTool?.(toolCall.name, toolCall.argsJson) ?? executeTool(this.options.store, toolCall.name, toolCall.argsJson))
          receiptCount += 1
          if (outcome.kind === 'result') {
            const receipt: ToolReceipt = {
              runId: options.runId,
              stageId,
              agentId: stageId,
              callId: toolCall.id,
              toolName: toolCall.name,
              status: outcome.ok ? 'read' : 'failed',
              sources: sourcesForTool(toolCall)
            }
            toolReceipts.push(receipt)
            this.emit(options.sessionId, { type: 'tool-receipt', receipt }, options.runId)
            return { ok: outcome.ok, text: outcome.text, preview: outcome.preview }
          }

          const mutationKind = classifyMutation(outcome.change.toolName) ?? undefined
          const auditId = await options.approvalAudit.request({ runId: options.runId, toolName: outcome.change.toolName, mutationKind, argsJson: toolCall.argsJson, policy: options.approvalPolicy })
          const needsApproval = requiresApproval(options.approvalPolicy, outcome.change.toolName)
          const approved = needsApproval
            ? (this.emit(options.sessionId, { type: 'pending-change', change: outcome.change }, options.runId), await this.waitConfirm(outcome.change, options.sessionId, options.signal))
            : true
          let ok = approved
          let text = approved ? '' : '用户拒绝了此变更。请勿原样重复提交。'
          let status: 'applied' | 'rejected' | 'failed' = approved ? 'failed' : 'rejected'
          if (approved) {
            try {
              const applied = await outcome.apply()
              ok = applied.ok
              text = applied.text
              status = applied.ok ? 'applied' : 'failed'
            } catch (error) {
              ok = false
              text = `写入失败：${error instanceof Error ? error.message : String(error)}`
              status = 'failed'
            }
          }
          if (!text) text = ok ? '变更已写入' : '写入失败'
          await options.approvalAudit.resolve(auditId, {
            decision: options.signal.aborted ? 'invalidated' : approved ? 'approved' : 'rejected',
            result: options.signal.aborted ? 'invalidated' : status,
            resultSummary: text
          })
          const receipt: ToolReceipt = { runId: options.runId, stageId, agentId: stageId, callId: toolCall.id, toolName: toolCall.name, status, sources: sourcesForTool(toolCall) }
          toolReceipts.push(receipt)
          this.emit(options.sessionId, { type: 'tool-receipt', receipt }, options.runId)
          this.emit(options.sessionId, { type: 'change-result', changeId: outcome.change.id, status, message: text }, options.runId)
          return { ok, text, preview: ok ? '变更已写入' : text }
        }
        try {
          const runStageLoop = () => runToolLoop({
            getMessages: () => stageMessages,
            appendMessage: (message) => {
              stageMessages.push(message)
              if (message.role === 'tool') options.session.messages.push(message)
            },
            maxRounds: Math.max(1, Math.min(MAX_TOOL_ROUNDS, orchestration?.maxCalls ?? MAX_TOOL_ROUNDS)),
            createMessageId: (kind) => `${options.runId}_${stageId}_${kind}_${++messageSequence}`,
            callModel: async ({ round, messageId, messages }) => {
              const estimatedInputTokens = Math.max(1, estimateTextTokens(roleSystem) + estimateTextTokens(prompt) + messages.reduce((sum, item) => sum + estimateTextTokens(item.text), 0) + estimateTextTokens(JSON.stringify(tools)))
              const maxOutputTokens = Math.max(1, Math.min(runtime.settings.maxOutputTokens, maxEstimatedTokens - estimatedInputTokens))
              const stageParams: ModelParams = { ...runtime.settings, maxOutputTokens }
              const requestId = `${options.runId}:${stageId}:${round}:${++messageSequence}`
              const requestContext: RequestContextUsage = {
                requestId,
                runId: options.runId,
                stageId,
                agentId: stageId,
                model: runtime.model,
                estimatedInputTokens,
                reservedOutputTokens: maxOutputTokens,
                contextLimit: stageParams.contextTokens,
                sourceTokens: (options.sourceRefs ?? []).reduce((sum, source) => sum + source.length, 0),
                skillTokens: estimateTextTokens(stageSkills.prompt),
                historyTokens: messages.reduce((sum, item) => sum + estimateTextTokens(item.text), 0),
                artifactTokens: estimateTextTokens(prompt)
              }
              requestContexts.push(requestContext)
              this.emit(options.sessionId, { type: 'request-context', usage: requestContext }, options.runId)
              const result = await gateway.call({
                callId: requestId,
                runId: options.runId,
                stageId,
                agentId: stageId,
                purpose: 'stage',
                providerId: runtime.provider?.id ?? options.providerId,
                providerName: runtime.provider?.name ?? runtime.provider?.id ?? options.providerName,
                model: runtime.model,
                estimatedInputTokens,
                maxOutputTokens,
                maxAttempts: 2,
                execute: () => runtime.adapter.stream(runtime.model, {
                  system: roleSystem,
                  messages,
                  tools,
                  signal: options.signal,
                  params: stageParams
                }, runtime.apiKey, {
                  onText: (delta) => {
                    stagePartials.set(stageId, `${stagePartials.get(stageId) ?? ''}${delta}`)
                    this.emit(options.sessionId, { type: 'text-delta', messageId, delta }, options.runId)
                  },
                  onToolCallStart: (callId, name) => this.emit(options.sessionId, { type: 'tool-start', callId, name, argsJson: '' }, options.runId),
                  onToolArgsDelta: (callId, delta) => this.emit(options.sessionId, { type: 'tool-args-delta', callId, delta }, options.runId),
                  onToolCallComplete: (callId, name, argsJson) => this.emit(options.sessionId, { type: 'tool-start', callId, name, argsJson }, options.runId)
                })
              })
              this.emit(options.sessionId, { type: 'budget', snapshot: gateway.budget.snapshot() }, options.runId)
              return result
            },
            executeTool: executeStageTool,
            onToolStart: (toolCall) => this.emit(options.sessionId, { type: 'tool-start', callId: toolCall.id, name: toolCall.name, argsJson: toolCall.argsJson }, options.runId),
            onToolDone: (toolCall, toolResult) => this.emit(options.sessionId, { type: 'tool-done', callId: toolCall.id, ok: toolResult.ok, resultPreview: toolResult.preview }, options.runId)
          })
          let loopResult = await runStageLoop()
          while (loopResult.waitingUser || loopResult.waitingCandidate) {
            const waitingUser = loopResult.waitingUser
            const waitingCandidate = loopResult.waitingCandidate
            const answerText = waitingUser
              ? JSON.stringify((await this.waitForQuestion(waitingUser.question.questionId, options.signal)).answers)
              : JSON.stringify(await this.waitForSkillCandidate(waitingCandidate!.candidate.candidateId, options.signal))
            const toolCall = waitingUser?.toolCall ?? waitingCandidate!.toolCall
            stageMessages.push({
              id: `${options.runId}_${stageId}_answer_${++messageSequence}`,
              role: 'tool',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              text: answerText
            })
            options.session.messages.push(stageMessages.at(-1)!)
            loopResult = await runStageLoop()
          }
          return { text: loopResult.text, hasToolReceipt: receiptCount > 0 }
        } catch (error) {
          const partialText = stagePartials.get(stageId)
          if (partialText) (error as { partialText?: string }).partialText = partialText
          this.emit(options.sessionId, { type: 'error', message: `阶段 ${stageId} 失败：${error instanceof Error ? error.message : String(error)}` }, options.runId)
          throw error
        }
      }
    })
    const configuredStages = orchestration?.enabledStageIds ?? []
    const enabledStageIds = Array.isArray(orchestration?.enabledStageIds)
      ? configuredStages.filter((stageId): stageId is StageId => ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'].includes(stageId))
      : undefined
    const result = await scheduler.run({
      runId: options.runId,
      workspaceId: this.options.workspaceId ?? 'workspace',
      sourceRevision: options.sourceRevision,
      goal: options.message,
      originalText: options.originalText,
      history: [
        options.history,
        subagentFindings.length
          ? `【子智能体只读核对】\n${subagentFindings.map((finding) => `${finding.role}：${finding.text}`).join('\n\n')}`
          : ''
      ].filter(Boolean).join('\n\n'),
      enabledStageIds
    })
    const finalText = result.artifacts.find((artifact) => artifact.stageId === 'polish')?.text
      ?? result.artifacts.find((artifact) => artifact.stageId === 'write')?.text
      ?? result.artifacts.at(-1)?.text
    if (finalText?.trim()) options.session.messages.push({ id: `msg_${Date.now().toString(36)}_orchestration`, role: 'assistant', text: finalText })
    if (result.status === 'paused_budget') {
      const currentStage = result.stages.find((stage) => stage.status === 'paused_budget')?.stageId
      const message = result.error ?? '模型调用预算已用尽，编排已暂停；请提高本次会话预算后继续。'
      this.emit(options.sessionId, { type: 'run-paused', reason: 'budget', message, ...(currentStage ? { stageId: currentStage } : {}) }, options.runId)
      options.session.messages.push({ id: `msg_${Date.now().toString(36)}_orchestration_pause`, role: 'assistant', text: `编排已暂停：${message}` })
    }
    const record: OrchestrationRunRecord = {
      runId: options.runId,
      status: result.status,
      sourceRevision: options.sourceRevision,
      originalText: options.originalText,
      stages: result.stages,
      artifacts: result.artifacts,
      overlay: result.overlay.toJSON(),
      businessText: result.businessText,
      updatedAt: Date.now(),
      budget: gateway.budget.snapshot(),
      toolReceipts,
      requestContexts,
      skillEvents,
      ...(result.error ? { error: result.error } : {}),
      ...(result.stages.find((stage) => stage.status === 'running' || stage.status === 'paused_budget')?.stageId
        ? { currentStage: result.stages.find((stage) => stage.status === 'running' || stage.status === 'paused_budget')?.stageId }
        : {})
    }
    options.session.orchestrationRuns = [...(options.session.orchestrationRuns ?? []).filter((item) => item.runId !== options.runId), record].slice(-10)
  }

  async run(req: RunAgentRequest): Promise<{ sessionId: string; runId: string; goalId?: string; status?: GoalRun['status']; planVersion?: number }> {
    const reservedRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    if (req.sessionId) this.pendingRunIds.set(req.sessionId, reservedRunId)
    const session = (req.sessionId ? await this.options.sessions.load(req.sessionId) : null) ?? await this.options.sessions.create()
    const sid = session.id
    session.creativePreferences = req.creative === undefined
      ? (session.creativePreferences ? validateCreativePreferences(session.creativePreferences) : normalizeCreativePreferences(undefined))
      : validateCreativePreferences(req.creative)
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
    let approvalAudit: ApprovalAuditLog | null = null
    let goalResult: { goalId: string; status: GoalRun['status']; planVersion: number } | undefined
    this.aborts.set(sid, controller)
    await this.options.sessions.save(session).catch(() => {})
    this.emit(sid, { type: 'session', session }, runId)

    try {
      const settings = await this.options.settings()
      const approvalPolicy = normalizeApprovalPolicy(req.approvalPolicy)
      approvalAudit = new ApprovalAuditLog()
      this.emit(sid, { type: 'approval-policy', policy: approvalPolicy }, runId)
      const provider = settings.providers.find((item) => item.id === req.providerId)
      if (!provider || !provider.apiKey) throw new Error('找不到可用供应商或 API Key')
      const profile = profileForModel(req.model)
      const vision = provider.modelSettings?.[req.model]?.vision ?? profile.vision
      if (files.some((file) => file.kind === 'image') && !vision) throw new Error('当前模型不支持图片输入，请切换模型或移除图片')
      const adapter: LlmAdapter = this.options.getAdapter(provider.protocol, provider.baseUrl)
      const custom = settings.customPrompt?.trim()
      const basePrompt = SYSTEM_PROMPT
      if (this.options.globalSkillLibrary) {
        await Promise.all(builtinPackages.map((pkg) => this.options.globalSkillLibrary!.ensure(pkg).catch(() => undefined)))
      }
      const installedPackages = await (this.options.globalSkillLibrary
        ? this.options.globalSkillLibrary.list()
        : new ContentPackageStore(this.options.store).list()).catch(() => [])
      const disabledBuiltins = new Set(installedPackages.filter((item) => builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version) && !item.enabled).map((item) => `${item.manifest.id}@${item.manifest.version}`))
      const activeBuiltins = builtinPackages.filter((item) => !disabledBuiltins.has(`${item.manifest.id}@${item.manifest.version}`))
      const activeInstalled = installedPackages.filter((item) => item.enabled && !builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version))
      const creative = session.creativePreferences ?? normalizeCreativePreferences(undefined)
      const skillSnapshot = this.options.globalSkillLibrary
        ? await new SkillResolver(this.options.globalSkillLibrary).createSnapshot().catch(() => undefined)
        : undefined
      const basicSkillResolution = skillSnapshot && !creative.orchestrationEnabled
        ? await new SkillResolver(this.options.globalSkillLibrary!).resolve({
          runId,
          agentId: 'basic',
          query: message,
          selectedSkillIds: creative.selectedSkillIds,
          snapshot: skillSnapshot,
          emit: (event) => this.emit(sid, { type: 'skill-activity', activity: event }, runId)
        })
        : { prompt: '' }
      const workspaceRules = await new RuleStore(this.options.store).load().catch(() => [])
      const resolvedRules = resolveRules([...workspaceRules, ...selectedRuleLayers(creative, [...activeBuiltins, ...activeInstalled])], { customPrompt: custom })
      const rulesForStage = (stageId: string): string => resolvedRules.effective
        .filter((rule) => rule.target === 'all' || rule.target === stageId)
        .map((rule) => `工作区规则 ${rule.target}.${rule.key}（${rule.severity}）：${JSON.stringify(rule.value)}`)
        .join('\n')
      // Existing embedders without a global library keep the bundled guidance path;
      // production adapters use the stage-scoped global snapshot below.
      const packageGuidance = creative.orchestrationEnabled && this.options.globalSkillLibrary
        ? ''
        : promptWithCreativeGuidance(basePrompt, creative, [...activeBuiltins, ...activeInstalled])
      const prompt = `${packageGuidance}${basicSkillResolution.prompt ? `\n\n【运行时已匹配 Skill】\n${basicSkillResolution.prompt}` : ''}${rulesForStage('all') ? `\n\n【工作区规则】\n${rulesForStage('all')}` : ''}\n\n【工具权限】\n${approvalGuidance(approvalPolicy)}`
      const resolvedSettings = resolveModelSettings(provider, req.model)
      const effectiveSettings: ModelParams = req.reasoning === undefined ? resolvedSettings : { ...resolvedSettings, reasoning: req.reasoning }
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

      if (req.mode === 'goal' || req.goalRunId) {
        goalResult = await this.runGoalMode({
          req,
          runId,
          sessionId: sid,
          session,
          message,
          prompt: promptWithSummary,
          provider,
          adapter,
          effectiveSettings,
          gateway: basicGateway,
          signal: controller.signal,
          approvalPolicy,
          approvalAudit,
          context: modelMessages().map((item) => `${item.role}: ${item.text ?? ''}`).join('\n')
        })
      } else if (creative.orchestrationEnabled) {
        const attachedChapter = req.attachments?.find((attachment) => attachment.kind === 'chapter')
        const projectContext = await loadProjectContext(this.options.store, { workspaceId: this.options.workspaceId ?? 'workspace', goal: message }).catch(() => null)
        const contextText = projectContext ? summarizeProjectContext(projectContext) : ''
        const originalText = attachedChapter
          ? await getChapterBody(this.options.store, attachedChapter.id).catch(() => null) ?? ''
          : projectContext?.targetContent ?? ''
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
          providers: settings.providers,
          history: [modelMessages().map((item) => `${item.role}: ${item.text ?? ''}`).join('\n'), contextText].filter(Boolean).join('\n\n'),
          originalText,
          sourceRevision: contentRevision(originalText),
          stageRuleGuidance: rulesForStage,
          signal: controller.signal,
          session,
          gateway: basicGateway,
          skillSnapshot,
          sourceRefs: projectContext?.sourceRefs,
          approvalPolicy,
          approvalAudit
        })
      } else {
        let round = 0
        let previousToolSignature = ''
        let repeatedToolRounds = 0
        const toolArgBuffers = new Map<string, string>()
        const toolPreviews = new Map<string, ToolBodyPreview>()
        const basicTools = [...TOOL_DEFS, ...QUESTION_TOOL_DEFS, ...SKILL_TOOL_DEFS]
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
          maxAttempts: 2,
          execute: () => adapter.stream(
            req.model,
            { system: promptWithSummary, messages, tools: basicTools, signal: controller.signal, params: effectiveSettings },
            provider.apiKey,
            { onText: (delta) => {
              streamedText.set(assistantId, `${streamedText.get(assistantId) ?? ''}${delta}`)
              this.emit(sid, { type: 'text-delta', messageId: assistantId, delta }, runId)
            },
            onToolCallStart: (callId, name) => {
              if (name === 'save_chapter') toolPreviews.set(callId, new ToolBodyPreview({ toolName: name, contentPath: ['chapter', 'content'] }))
              this.emit(sid, { type: 'tool-start', callId, name, argsJson: toolArgBuffers.get(callId) ?? '' }, runId)
            },
            onToolArgsDelta: (callId, delta) => {
              toolArgBuffers.set(callId, `${toolArgBuffers.get(callId) ?? ''}${delta}`)
              this.emit(sid, { type: 'tool-args-delta', callId, delta }, runId)
              const preview = toolPreviews.get(callId)?.push(delta)
              if (preview) this.emit(sid, { type: 'tool-preview', callId, preview }, runId)
            },
            onToolCallComplete: (callId, _name, argsJson) => {
              toolArgBuffers.set(callId, argsJson)
              const preview = toolPreviews.get(callId)?.replace(argsJson)
              if (preview) this.emit(sid, { type: 'tool-preview', callId, preview }, runId)
            }
            }
          )
        })
        this.emit(sid, { type: 'budget', snapshot: basicGateway.budget.snapshot() }, runId)
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

        if (result.toolCalls.length > 1 && result.toolCalls.some((toolCall) => toolCall.name === 'ask_user' || toolCall.name === 'propose_skill_package')) {
          for (const toolCall of result.toolCalls) {
            this.emit(sid, { type: 'tool-start', callId: toolCall.id, name: toolCall.name, argsJson: toolCall.argsJson }, runId)
            const text = 'ask_user 或 propose_skill_package 必须作为本轮唯一工具调用，请重新提交单个控制工具调用。'
            this.emit(sid, { type: 'tool-done', callId: toolCall.id, ok: false, resultPreview: '控制工具不能与其它工具混用' }, runId)
            session.messages.push({ id: `msg_${Date.now().toString(36)}_${toolCall.id}_mixed`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text, isError: true })
          }
          continue
        }

        for (const toolCall of result.toolCalls) {
          this.emit(sid, { type: 'tool-start', callId: toolCall.id, name: toolCall.name, argsJson: toolCall.argsJson }, runId)
          if (toolCall.name === 'ask_user') {
            const question = await this.openQuestion({
              argsJson: toolCall.argsJson,
              runId,
              sessionId: sid,
              agentId: 'basic',
              session
            })
            this.emit(sid, { type: 'tool-done', callId: toolCall.id, ok: true, resultPreview: '等待用户回答' }, runId)
            const answer = await this.waitForQuestion(question.questionId, controller.signal)
            session.messages.push({
              id: `msg_${Date.now().toString(36)}_answer`,
              role: 'tool',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              text: JSON.stringify(answer.answers)
            })
            break
          }
          if (SKILL_TOOL_DEFS.some((tool) => tool.name === toolCall.name)) {
            const skillResult = this.options.globalSkillLibrary && skillSnapshot
              ? await executeSkillTool(this.options.globalSkillLibrary, toolCall.name, toolCall.argsJson, skillSnapshot)
              : { ok: false, text: '当前运行没有全局 Skill 库', preview: 'Skill 库不可用' }
            this.emit(sid, { type: 'tool-done', callId: toolCall.id, ok: skillResult.ok, resultPreview: skillResult.preview }, runId)
            if (toolCall.name === 'propose_skill_package' && skillResult.ok && skillResult.candidatePackage) {
              const candidate = await this.openSkillCandidate({
                package: skillResult.candidatePackage,
                reason: skillResult.candidateReason ?? '智能体建议该 Skill 用于当前任务',
                runId,
                sessionId: sid,
                stageId: 'basic',
                agentId: 'basic',
                session
              })
              const resolution = await this.waitForSkillCandidate(candidate.candidateId, controller.signal)
              session.messages.push({
                id: `msg_${Date.now().toString(36)}_candidate_answer`,
                role: 'tool',
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                text: JSON.stringify(resolution)
              })
              break
            }
            session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text: skillResult.text, isError: !skillResult.ok })
            continue
          }
          const outcome = await (this.options.executeTool?.(toolCall.name, toolCall.argsJson) ?? executeTool(this.options.store, toolCall.name, toolCall.argsJson))
          if (outcome.kind === 'result') {
            this.emit(sid, { type: 'tool-done', callId: toolCall.id, ok: outcome.ok, resultPreview: outcome.preview }, runId)
            session.messages.push({ id: `msg_${Date.now().toString(36)}`, role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text: outcome.text, isError: !outcome.ok })
            continue
          }

          const mutationKind = classifyMutation(outcome.change.toolName)
          const change: PendingChange = { ...outcome.change, ...(mutationKind ? { mutationKind } : {}) }
          const auditId = approvalAudit
            ? await approvalAudit.request({ runId, toolName: change.toolName, mutationKind: mutationKind ?? undefined, argsJson: toolCall.argsJson, policy: approvalPolicy })
            : undefined
          const needsApproval = requiresApproval(approvalPolicy, change.toolName)
          let approved = true
          if (needsApproval) {
            this.emit(sid, { type: 'pending-change', change }, runId)
            approved = await this.waitConfirm(change, sid, controller.signal)
          }
          let ok = approved
          let text = approved ? '' : '用户拒绝了此变更。请勿原样重复提交。'
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
          if (!text) text = '变更已写入'
          if (auditId && approvalAudit) {
            await approvalAudit.resolve(auditId, {
              decision: controller.signal.aborted ? 'invalidated' : approved ? 'approved' : 'rejected',
              result: controller.signal.aborted ? 'invalidated' : status === 'applied' ? 'applied' : status,
              resultSummary: text
            })
          }
          this.emit(sid, { type: 'change-result', changeId: change.id, status, message: text }, runId)
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
      await approvalAudit?.invalidatePending(runId).catch(() => {})
      await this.clearQuestionsForRun(runId, session)
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
    return { sessionId: sid, runId, ...(goalResult ? { goalId: goalResult.goalId, status: goalResult.status, planVersion: goalResult.planVersion } : {}) }
  }
}

function toolRoundSignature(calls: ToolCallData[]): string {
  return calls
    .map((call) => `${call.name}:${call.argsJson}`)
    .sort()
    .join('\n')
}
