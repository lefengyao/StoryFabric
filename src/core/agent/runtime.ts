import { ClientRunIdRegistry } from '../../shared/agentRuntime'
import type { RunEventEnvelope, RuntimeEvent } from '../../shared/agentRuntime'
import { RunEventLedger } from './events'
import { MemoryRunStore, type RunStore, type RuntimeRunSnapshot } from './runStore'

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
      draftSaveStatus: 'saved'
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
    this.controllers.get(runId)?.abort()
    this.finish(snapshot, 'cancelled')
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
        }
      })
      if (!isTerminal(snapshot.status)) this.finish(snapshot, 'completed')
    } catch (error) {
      if (!isTerminal(snapshot.status)) {
        this.append(snapshot, input, { type: controller.signal.aborted ? 'run-paused' : 'run-error', payload: { message: error instanceof Error ? error.message : String(error) } })
        this.finish(snapshot, controller.signal.aborted ? 'cancelled' : 'failed')
      }
    } finally {
      await this.persist(snapshot)
      const parentKey = `${snapshot.workspaceId}\u0000${snapshot.sessionId}`
      if (this.activeParents.get(parentKey) === snapshot.runId) this.activeParents.delete(parentKey)
      this.controllers.delete(snapshot.runId)
    }
  }

  private append(snapshot: RuntimeRunSnapshot, input: RuntimeStartInput, event: RuntimeEvent): RunEventEnvelope {
    const envelope = this.ledgers.get(snapshot.runId)!.append({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      runId: snapshot.runId,
      agentId: input.agentId,
      ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
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

  private async persist(snapshot: RuntimeRunSnapshot): Promise<void> {
    const previous = this.persistQueues.get(snapshot.runId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      try {
        const existing = await this.store.get(snapshot.runId)
        if (!existing) await this.store.create(snapshot)
        else await this.store.save(snapshot)
        snapshot.draftSaveStatus = 'saved'
      } catch {
        snapshot.draftSaveStatus = 'unsaved'
      }
    })
    this.persistQueues.set(snapshot.runId, next)
    await next
    if (this.persistQueues.get(snapshot.runId) === next) this.persistQueues.delete(snapshot.runId)
  }
}

function isTerminal(status: RuntimeRunSnapshot['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted'
}
