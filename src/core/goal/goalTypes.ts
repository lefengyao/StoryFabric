import type { GoalRun, GoalTask } from '../../shared/types'

export interface GoalTaskExecutionResult {
  summary: string
}

export interface GoalValidationResult {
  passed: boolean
  reason: string
}

export interface GoalRuntimeEvent {
  type: 'goal-plan' | 'goal-task' | 'goal-validation'
  goalId: string
  taskId?: string
  goal?: GoalRun
  task?: GoalTask
  validation?: GoalValidationResult
}

export interface GoalRunnerDeps {
  plan(goal: GoalRun, signal: AbortSignal): Promise<GoalTask[]>
  execute(goal: GoalRun, task: GoalTask, signal: AbortSignal): Promise<GoalTaskExecutionResult>
  validate(goal: GoalRun, task: GoalTask, signal: AbortSignal): Promise<GoalValidationResult>
  save(goal: GoalRun): Promise<void>
  emit(event: GoalRuntimeEvent): void
}
