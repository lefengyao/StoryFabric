import type { RunEventEnvelope } from '../../shared/agentRuntime'

export type RuntimeRunStatus = 'created' | 'queued' | 'running' | 'awaiting_user' | 'paused_budget' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type DraftSaveStatus = 'saved' | 'unsaved'

export interface RuntimeDraft {
  messageId: string
  text: string
}

export interface RuntimeRunSnapshot {
  runId: string
  workspaceId: string
  sessionId: string
  agentId: string
  parentAgentId?: string
  clientRunId?: string
  requestHash?: string
  status: RuntimeRunStatus
  createdAt: number
  updatedAt: number
  lastSeq: number
  drafts: RuntimeDraft[]
  events: RunEventEnvelope[]
  draftSaveStatus: DraftSaveStatus
  terminalEventEmitted?: boolean
}

export interface RunStore {
  create(snapshot: RuntimeRunSnapshot): Promise<void>
  get(runId: string): Promise<RuntimeRunSnapshot | null>
  save(snapshot: RuntimeRunSnapshot): Promise<void>
  list(workspaceId: string, sessionId?: string): RuntimeRunSnapshot[]
}

function clone(snapshot: RuntimeRunSnapshot): RuntimeRunSnapshot {
  return structuredClone(snapshot)
}

export class MemoryRunStore implements RunStore {
  private readonly snapshots = new Map<string, RuntimeRunSnapshot>()

  async create(snapshot: RuntimeRunSnapshot): Promise<void> {
    if (this.snapshots.has(snapshot.runId)) throw new Error('运行已存在')
    this.snapshots.set(snapshot.runId, clone(snapshot))
  }

  async get(runId: string): Promise<RuntimeRunSnapshot | null> {
    const snapshot = this.snapshots.get(runId)
    return snapshot ? clone(snapshot) : null
  }

  async save(snapshot: RuntimeRunSnapshot): Promise<void> {
    if (!this.snapshots.has(snapshot.runId)) throw new Error('运行不存在')
    this.snapshots.set(snapshot.runId, clone(snapshot))
  }

  list(workspaceId: string, sessionId?: string): RuntimeRunSnapshot[] {
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.workspaceId === workspaceId && (!sessionId || snapshot.sessionId === sessionId))
      .map(clone)
  }
}
