import type { ApprovalPolicy, GoalRun } from '../../shared/types'
import { normalizeApprovalPolicy, validateGoalTasks } from '../../shared/creative'
import type { FileStore } from '../storage/fileStore'
import { genId } from '../workspace/entityStore'

const GOAL_DIR = '.storyfabric/goals'

type CreateGoalInput = {
  workspaceId: string
  sessionId: string
  goal: string
  approvalPolicy: ApprovalPolicy
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('目标 ID 无效')
  return id
}

function parseSnapshot(raw: string, expectedId: string): GoalRun | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== 'object') return null
    if (value.id !== expectedId || typeof value.workspaceId !== 'string' || typeof value.sessionId !== 'string' || typeof value.goal !== 'string') return null
    const status = ['planning', 'running', 'awaiting-approval', 'validating', 'completed', 'needs-attention', 'cancelled'].includes(String(value.status))
      ? value.status as GoalRun['status']
      : null
    if (!status || !Number.isInteger(value.planVersion) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) return null
    const tasksValue = Array.isArray(value.tasks) ? value.tasks : []
    const tasks = tasksValue.length ? validateGoalTasks(tasksValue) : []
    return {
      id: expectedId,
      workspaceId: value.workspaceId,
      sessionId: value.sessionId,
      goal: value.goal,
      status,
      planVersion: value.planVersion as number,
      tasks,
      approvalPolicy: normalizeApprovalPolicy(value.approvalPolicy),
      createdAt: value.createdAt as number,
      updatedAt: value.updatedAt as number,
      ...(typeof value.completedReason === 'string' ? { completedReason: value.completedReason } : {}),
      ...(typeof value.needsAttentionReason === 'string' ? { needsAttentionReason: value.needsAttentionReason } : {})
    }
  } catch {
    return null
  }
}

export class GoalStore {
  constructor(private readonly files: FileStore) {}

  private path(id: string): string {
    return `${GOAL_DIR}/${safeId(id)}.json`
  }

  async create(input: CreateGoalInput): Promise<GoalRun> {
    const goalText = input.goal.trim()
    if (!goalText) throw new Error('目标不能为空')
    const now = Date.now()
    const snapshot: GoalRun = {
      id: genId('goal'),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      goal: goalText,
      status: 'planning',
      planVersion: 1,
      tasks: [],
      approvalPolicy: normalizeApprovalPolicy(input.approvalPolicy),
      createdAt: now,
      updatedAt: now
    }
    await this.save(snapshot)
    return snapshot
  }

  async get(id: string): Promise<GoalRun | null> {
    const normalized = safeId(id)
    const raw = await this.files.readText(this.path(normalized))
    return raw === null ? null : parseSnapshot(raw, normalized)
  }

  async save(goal: GoalRun): Promise<void> {
    safeId(goal.id)
    await this.files.ensureDir(GOAL_DIR)
    const snapshot: GoalRun = {
      ...goal,
      goal: goal.goal.trim(),
      approvalPolicy: normalizeApprovalPolicy(goal.approvalPolicy),
      tasks: goal.tasks.length ? validateGoalTasks(goal.tasks) : [],
      updatedAt: Date.now()
    }
    await this.files.writeText(this.path(goal.id), JSON.stringify(snapshot, null, 2))
  }

  async list(workspaceId: string): Promise<GoalRun[]> {
    const names = await this.files.listFiles(GOAL_DIR, '.json')
    const goals: GoalRun[] = []
    for (const name of names) {
      const id = name.slice(0, -'.json'.length)
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue
      const goal = await this.get(id)
      if (goal && goal.workspaceId === workspaceId) goals.push(goal)
    }
    return goals.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async assertWorkspace(id: string, workspaceId: string): Promise<GoalRun> {
    const goal = await this.get(id)
    if (!goal || goal.workspaceId !== workspaceId) throw new Error('目标不属于当前工作区')
    return goal
  }
}
