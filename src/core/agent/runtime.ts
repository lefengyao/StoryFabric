import { ClientRunIdRegistry } from '../../shared/agentRuntime'
import type { RunEventEnvelope, RuntimeEvent } from '../../shared/agentRuntime'
import { parseAgentQuestion, validateAgentQuestionAnswer, type AgentQuestion, type AgentQuestionAnswer } from '../../shared/agentQuestions'
import { RunEventLedger } from './events'
import { MemoryRunStore, type RunStore, type RuntimeRunSnapshot } from './runStore'
import { RunController, type RunPauseReason } from './runController'
import type { AgentBudgetSnapshot } from '../../shared/types'

export interface RuntimeStartInput {
  workspaceId: string
  sessionId: string
  agentId: string
  parentAgentId?: string
  clientRunId?: string
  requestHash?: string
}

export interface RuntimeContext {
  runId: string
  signal: AbortSignal
  text(messageId: string, delta: string): void
  emit(event: RuntimeEvent): void
  stage(stageId: string): void
  stageComplete(stageId: string): void
  budget(snapshot: AgentBudgetSnapshot): void
  pause(reason: RunPauseReason, message: string): void
  awaitUser(question: AgentQuestion): Promise<AgentQuestionAnswer>
}

export type RuntimeRunner = (context: RuntimeContext) => Promise<void> | void

export interface RuntimeStartHandle {
  created: boolean
  runId: string
  done: Promise<void>
}

export interface AgentRuntimeOptions {
  store?: RunStore
  idFactory?: () => string
  now?: () => number
}

function defaultId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class AgentRuntime {
  private readonly store: RunStore
  private readonly idFactory: () => string
  private readonly now: () => number
  private readonly runs = new Map<string, RuntimeRunSnapshot>()
  private readonly ledgers = new Map<string, RunEventLedger>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly activeParents = new Map<string, string>()
  private readonly clientRuns = new ClientRunIdRegistry()
  private readonly completions = new Map<string, Promise<void>>()
  private readonly persistQueues = new Map<string, Promise<void>>()
  private readonly questionWaiters = new Map<string, { runId: string; question: AgentQuestion; resolve: (answer: AgentQuestionAnswer) => void; reject: (error: Error) => void; promise: Promise<AgentQuestionAnswer> }>()
  private readonly answeredQuestions = new Map<string, AgentQuestionAnswer>()
  private readonly answeringQuestions = new Set<string>()
  private readonly answerInFlight = new Map<string, AgentQuestionAnswer>()

  constructor(options: AgentRuntimeOptions = {}) {
    this.store = options.store ?? new MemoryRunStore()
    this.idFactory = options.idFactory ?? defaultId
    this.now = options.now ?? Date.now
  }

  start(input: RuntimeStartInput, runner: RuntimeRunner): RuntimeStartHandle {
    const parentKey = `${input.workspaceId}\u0000${input.sessionId}`
    const activeRunId = this.activeParents.get(parentKey)
    if (activeRunId) {
      if (input.clientRunId) {
        const existing = this.runs.get(activeRunId)
        if (existing?.clientRunId === input.clientRunId && existing.requestHash === input.requestHash) {
          return { created: false, runId: activeRunId, done: this.completions.get(activeRunId) ?? Promise.resolve() }
        }
      }
      throw new Error('同一会话已有运行')
    }

    const runId = this.idFactory()
    if (input.clientRunId) {
      const claim = this.clientRuns.claim({
        workspaceId: input.workspaceId,
        clientRunId: input.clientRunId,
        requestHash: input.requestHash ?? `${input.sessionId}:${input.agentId}`,
        runId
      })
      if (!claim.created) return { created: false, runId: claim.runId, done: this.completions.get(claim.runId) ?? Promise.resolve() }
    }

    const snapshot: RuntimeRunSnapshot = {
      runId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
      ...(input.clientRunId ? { clientRunId: input.clientRunId } : {}),
      ...(input.requestHash ? { requestHash: input.requestHash } : {}),
      status: 'created',
      createdAt: this.now(),
      updatedAt: this.now(),
      lastSeq: 0,
      drafts: [],
      events: [],
      draftSaveStatus: 'saved',
      completedStages: []
    }
    this.runs.set(runId, snapshot)
    this.ledgers.set(runId, new RunEventLedger(this.now))
    this.activeParents.set(parentKey, runId)
    const controller = new AbortController()
    this.controllers.set(runId, controller)
    const done = this.execute(snapshot, input, controller, runner)
    this.completions.set(runId, done)
    return { created: true, runId, done }
  }

  cancel(runId: string): void {
    const snapshot = this.runs.get(runId)
    if (!snapshot || isTerminal(snapshot.status)) return
    for (const [questionId, waiter] of this.questionWaiters) {
      if (waiter.runId !== runId) continue
      this.questionWaiters.delete(questionId)
      const error = Object.assign(new Error('运行已取消'), { name: 'AbortError' })
      waiter.reject(error)
    }
    delete snapshot.waitingQuestion
    delete snapshot.questionId
    this.controllers.get(runId)?.abort()
    this.finish(snapshot, 'cancelled')
  }

  async answerQuestion(answer: AgentQuestionAnswer): Promise<void> {
    const answered = this.answeredQuestions.get(answer.questionId)
    if (answered) {
      if (JSON.stringify(answered) === JSON.stringify(answer)) return
      throw new Error('问题已经回答，不能替换答案')
    }
    const waiterEntry = [...this.questionWaiters.entries()].find(([questionId, waiter]) => {
      if (questionId === answer.questionId) return true
      const snapshot = this.runs.get(waiter.runId)
      return snapshot?.waitingQuestion?.questionId === answer.questionId
    })
    if (!waiterEntry) {
      const persisted = this.store.list('', '').find((snapshot) => snapshot.waitingQuestion?.questionId === answer.questionId)
      if (persisted) throw new Error('问题存在，但当前进程没有可安全继续运行的等待点；请重新启动本次任务')
      throw new Error('问题不存在或已经结束')
    }
    const [questionId, waiter] = waiterEntry
    const snapshot = this.runs.get(waiter.runId)!
    validateAgentQuestionAnswer(snapshot.waitingQuestion ?? waiter.question, answer)
    if (this.answeringQuestions.has(questionId)) {
      const inFlight = this.answerInFlight.get(questionId)
      if (inFlight && JSON.stringify(inFlight) === JSON.stringify(answer)) {
        await waiter.promise
        return
      }
      throw new Error('问题正在处理中，请勿替换答案')
    }
    if (this.questionWaiters.get(questionId) !== waiter) {
      const alreadyAnswered = this.answeredQuestions.get(questionId)
      if (alreadyAnswered && JSON.stringify(alreadyAnswered) === JSON.stringify(answer)) return
      throw new Error('问题已经由另一个回答请求处理')
    }
    this.answeringQuestions.add(questionId)
    this.answerInFlight.set(questionId, structuredClone(answer))
    const previousQuestion = snapshot.waitingQuestion ?? waiter.question
    const previousQuestionId = snapshot.questionId
    delete snapshot.waitingQuestion
    delete snapshot.questionId
    snapshot.status = 'running'
    snapshot.updatedAt = this.now()
    try {
      await this.persist(snapshot, true)
      const controller = this.controllers.get(waiter.runId)
      if (controller?.signal.aborted || isTerminal(snapshot.status)) {
        throw Object.assign(new Error('运行已取消，不能恢复问题'), { name: 'AbortError' })
      }
      this.questionWaiters.delete(questionId)
      this.answeredQuestions.set(questionId, structuredClone(answer))
      waiter.resolve(answer)
    } catch (error) {
      if (this.questionWaiters.get(questionId) === waiter && !isTerminal(snapshot.status)) {
        snapshot.waitingQuestion = previousQuestion
        snapshot.questionId = previousQuestionId
        snapshot.status = 'awaiting_user'
        await this.persist(snapshot).catch(() => undefined)
      }
      throw error
    } finally {
      this.answeringQuestions.delete(questionId)
      this.answerInFlight.delete(questionId)
    }
  }

  getSnapshot(runId: string): RuntimeRunSnapshot | null {
    const snapshot = this.runs.get(runId)
    return snapshot ? structuredClone(snapshot) : null
  }

  list(workspaceId: string, sessionId?: string): RuntimeRunSnapshot[] {
    return [...this.runs.values()]
      .filter((run) => run.workspaceId === workspaceId && (!sessionId || run.sessionId === sessionId))
      .map((run) => structuredClone(run))
  }

  private async execute(snapshot: RuntimeRunSnapshot, input: RuntimeStartInput, controller: AbortController, runner: RuntimeRunner): Promise<void> {
    const progress = new RunController(snapshot, this.now)
    snapshot.status = 'running'
    this.append(snapshot, input, { type: 'run-start' })
    void this.persist(snapshot)
    try {
      if (controller.signal.aborted || isTerminal(snapshot.status)) return
      await runner({
        runId: snapshot.runId,
        signal: controller.signal,
        text: (messageId, delta) => {
          if (controller.signal.aborted || isTerminal(snapshot.status)) return
          const draft = snapshot.drafts.find((item) => item.messageId === messageId)
          if (draft) draft.text += delta
          else snapshot.drafts.push({ messageId, text: delta })
          this.append(snapshot, input, { type: 'text-delta', messageId, delta })
          void this.persist(snapshot)
        },
        emit: (event) => {
          if (controller.signal.aborted || isTerminal(snapshot.status)) return
          this.append(snapshot, input, event)
          void this.persist(snapshot)
        },
        stage: (stageId) => progress.stage(stageId),
        stageComplete: (stageId) => progress.stageComplete(stageId),
        budget: (value) => progress.budget(value),
        pause: (reason, message) => {
          if (progress.isTerminal()) return
          progress.pause(reason, message)
          this.append(snapshot, input, { type: 'run-paused', payload: { reason, message } })
          this.finish(snapshot, snapshot.status)
          void this.persist(snapshot)
        },
        awaitUser: async (question) => {
          const parsed = parseAgentQuestion(question)
          if (parsed.runId !== snapshot.runId || parsed.sessionId !== snapshot.sessionId || parsed.agentId !== snapshot.agentId) {
            throw new Error('问题身份与运行不匹配')
          }
          if (controller.signal.aborted) throw Object.assign(new Error('运行已取消'), { name: 'AbortError' })
          snapshot.status = 'awaiting_user'
          snapshot.questionId = parsed.questionId
          snapshot.waitingQuestion = structuredClone(parsed)
          if (parsed.stageId) {
            progress.stage(parsed.stageId)
          }
          let resolve!: (answer: AgentQuestionAnswer) => void
          let reject!: (error: Error) => void
          const promise = new Promise<AgentQuestionAnswer>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise
            reject = rejectPromise
          })
          void promise.catch(() => {})
          this.questionWaiters.set(parsed.questionId, { runId: snapshot.runId, question: parsed, resolve, reject, promise })
          this.append(snapshot, input, { type: 'agent-question', payload: { questionId: parsed.questionId, question: parsed } }, parsed.stageId)
          this.append(snapshot, input, { type: 'waiting-user', payload: { questionId: parsed.questionId } }, parsed.stageId)
          await this.persist(snapshot)
          return promise
        }
      })
      if (!progress.isTerminal()) {
        progress.complete()
        this.finish(snapshot, 'completed')
      }
    } catch (error) {
      if (!isTerminal(snapshot.status)) {
        const message = error instanceof Error ? error.message : String(error)
        const reason: RunPauseReason = controller.signal.aborted ? 'cancelled' : (error as { code?: unknown })?.code === 'BUDGET_EXCEEDED' ? 'budget' : 'error'
        progress.pause(reason, message)
        this.append(snapshot, input, { type: reason === 'error' ? 'run-error' : 'run-paused', payload: { reason, message } })
        this.finish(snapshot, snapshot.status)
      }
    } finally {
      await this.persist(snapshot)
      const parentKey = `${snapshot.workspaceId}\u0000${snapshot.sessionId}`
      if (this.activeParents.get(parentKey) === snapshot.runId) this.activeParents.delete(parentKey)
      this.controllers.delete(snapshot.runId)
    }
  }

  private append(snapshot: RuntimeRunSnapshot, input: RuntimeStartInput, event: RuntimeEvent, stageId?: string): RunEventEnvelope {
    const envelope = this.ledgers.get(snapshot.runId)!.append({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      runId: snapshot.runId,
      agentId: input.agentId,
      ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
      ...(stageId ? { stageId } : {}),
      event
    })
    snapshot.events.push(envelope)
    snapshot.lastSeq = envelope.seq
    snapshot.updatedAt = this.now()
    return envelope
  }

  private finish(snapshot: RuntimeRunSnapshot, status: RuntimeRunSnapshot['status']): void {
    if (snapshot.terminalEventEmitted) return
    snapshot.status = status
    snapshot.terminalEventEmitted = true
    const input: RuntimeStartInput = {
      workspaceId: snapshot.workspaceId,
      sessionId: snapshot.sessionId,
      agentId: snapshot.agentId,
      ...(snapshot.parentAgentId ? { parentAgentId: snapshot.parentAgentId } : {})
    }
    this.append(snapshot, input, { type: 'run-done', payload: { status } })
    void this.persist(snapshot)
  }

  private async persist(snapshot: RuntimeRunSnapshot, strict = false): Promise<void> {
    const previous = this.persistQueues.get(snapshot.runId) ?? Promise.resolve()
    let failure: unknown
    const next = previous.catch(() => undefined).then(async () => {
      try {
        const existing = await this.store.get(snapshot.runId)
        if (!existing) await this.store.create(snapshot)
        else await this.store.save(snapshot)
        snapshot.draftSaveStatus = 'saved'
      } catch (error) {
        failure = error
        snapshot.draftSaveStatus = 'unsaved'
      }
    })
    this.persistQueues.set(snapshot.runId, next)
    await next
    if (this.persistQueues.get(snapshot.runId) === next) this.persistQueues.delete(snapshot.runId)
    if (strict && failure) throw failure
  }
}

function isTerminal(status: RuntimeRunSnapshot['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'paused_budget' || status === 'interrupted'
}
