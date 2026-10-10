import { cloneValue } from '../../shared/runtimeCompatibility'
import type { GoalRun, GoalTask } from '../../shared/types'
import { topologicalGoalTasks } from './goalPlanner'
import type { GoalRunnerDeps } from './goalTypes'

function cloneGoal(goal: GoalRun): GoalRun {
  return cloneValue(goal)
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError')
}

export class GoalRunner {
  private controller: AbortController | null = null
  private currentGoal: GoalRun | null = null
  private stopped = false

  constructor(private readonly deps: GoalRunnerDeps) {}

  async start(input: GoalRun): Promise<GoalRun> {
    if (this.controller) throw new Error('已有目标正在执行')
    this.stopped = false
    this.controller = new AbortController()
    const goal = cloneGoal(input)
    this.currentGoal = goal
    try {
      if (!goal.tasks.length) {
        goal.status = 'planning'
        await this.deps.save(goal)
        const planned = await this.deps.plan(goal, this.controller.signal)
        goal.tasks = topologicalGoalTasks(planned).map((task) => ({ ...task, status: 'pending', attempts: 0 }))
        this.deps.emit({ type: 'goal-plan', goalId: goal.id, goal: cloneGoal(goal) })
        await this.deps.save(goal)
      }
      goal.status = 'running'
      goal.completedReason = undefined
      goal.needsAttentionReason = undefined
      await this.deps.save(goal)
      await this.runTasks(goal)
      return cloneGoal(goal)
    } catch (error) {
      if (this.stopped || isAbortError(error) || this.controller.signal.aborted) {
        if (goal.status !== 'cancelled') {
          goal.status = 'cancelled'
          await this.deps.save(goal).catch(() => undefined)
        }
        return cloneGoal(goal)
      }
      goal.status = 'needs-attention'
      goal.needsAttentionReason = error instanceof Error ? error.message : '目标执行失败'
      await this.deps.save(goal).catch(() => undefined)
      return cloneGoal(goal)
    } finally {
      this.controller = null
      this.currentGoal = null
    }
  }

  private async runTasks(goal: GoalRun): Promise<void> {
    const signal = this.controller?.signal
    if (!signal) throw new Error('目标执行器未初始化')
    while (true) {
      if (signal.aborted || this.stopped) throw Object.assign(new Error('目标已停止'), { name: 'AbortError' })
      const next = goal.tasks.find((task) => task.status === 'pending' && task.dependsOn.every((id) => goal.tasks.find((item) => item.id === id)?.status === 'completed'))
      if (!next) {
        if (goal.tasks.every((task) => task.status === 'completed')) {
          goal.status = 'completed'
          goal.completedReason = '所有目标任务均通过验收'
        } else {
          goal.status = 'needs-attention'
          goal.needsAttentionReason = '存在无法满足依赖的目标任务'
        }
        await this.deps.save(goal)
        return
      }
      next.status = 'running'
      next.attempts += 1
      this.deps.emit({ type: 'goal-task', goalId: goal.id, task: cloneValue(next) })
      await this.deps.save(goal)
      let execution
      try {
        execution = await this.deps.execute(goal, next, signal)
      } catch (error) {
        if (isAbortError(error) || signal.aborted || this.stopped) throw error
        next.status = next.attempts >= 2 ? 'failed' : 'pending'
        next.validationReason = error instanceof Error ? error.message : '任务执行失败'
        this.deps.emit({ type: 'goal-task', goalId: goal.id, task: cloneValue(next) })
        await this.deps.save(goal)
        if (next.status === 'failed') {
          goal.status = 'needs-attention'
          goal.needsAttentionReason = next.validationReason
          await this.deps.save(goal)
          return
        }
        continue
      }
      next.resultSummary = execution.summary
      next.status = 'validating'
      goal.status = 'validating'
      this.deps.emit({ type: 'goal-task', goalId: goal.id, task: cloneValue(next) })
      await this.deps.save(goal)
      const validation = await this.deps.validate(goal, next, signal)
      this.deps.emit({ type: 'goal-validation', goalId: goal.id, taskId: next.id, validation })
      if (validation.passed) {
        next.status = 'completed'
        next.validationReason = validation.reason
      } else if (next.attempts < 2) {
        next.status = 'pending'
        next.validationReason = validation.reason
      } else {
        next.status = 'failed'
        next.validationReason = validation.reason
        goal.status = 'needs-attention'
        goal.needsAttentionReason = `${next.title}：${validation.reason}`
      }
      if (goal.status === 'validating') goal.status = 'running'
      this.deps.emit({ type: 'goal-task', goalId: goal.id, task: cloneValue(next) })
      await this.deps.save(goal)
      if (goal.status === 'needs-attention') return
    }
  }

  async stop(): Promise<GoalRun | null> {
    const goal = this.currentGoal
    if (!goal) return null
    this.stopped = true
    this.controller?.abort()
    for (const task of goal.tasks) if (task.status === 'running' || task.status === 'validating') task.status = 'pending'
    goal.status = 'cancelled'
    goal.needsAttentionReason = undefined
    await this.deps.save(goal)
    return cloneGoal(goal)
  }

  async resume(goal: GoalRun): Promise<GoalRun> {
    if (goal.status !== 'cancelled' && goal.status !== 'needs-attention' && goal.status !== 'awaiting-approval') throw new Error('只有已停止、等待审批或需介入的目标可以恢复')
    const next = cloneGoal(goal)
    next.status = 'running'
    next.needsAttentionReason = undefined
    for (const task of next.tasks) if (task.status === 'running' || task.status === 'validating' || task.status === 'failed' || task.status === 'awaiting-approval') task.status = 'pending'
    return this.start(next)
  }

  async replan(goal: GoalRun): Promise<GoalRun> {
    const next = cloneGoal(goal)
    next.status = 'planning'
    next.tasks = []
    next.planVersion += 1
    await this.deps.save(next)
    return this.start(next)
  }
}
