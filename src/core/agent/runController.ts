import type { AgentBudgetSnapshot } from '../../shared/types'
import type { RuntimeRunSnapshot } from './runStore'

export type RunPauseReason = 'budget' | 'cancelled' | 'error'

/** Keeps resumable progress separate from the transport that renders run events. */
export class RunController {
  constructor(private readonly snapshot: RuntimeRunSnapshot, private readonly now: () => number = Date.now) {}

  stage(stageId: string): void {
    if (!stageId || this.isTerminal()) return
    this.snapshot.currentStage = stageId
    this.touch()
  }

  stageComplete(stageId: string): void {
    if (!stageId || this.isTerminal()) return
    const completed = this.snapshot.completedStages ?? (this.snapshot.completedStages = [])
    if (!completed.includes(stageId)) completed.push(stageId)
    this.touch()
  }

  budget(value: AgentBudgetSnapshot): void {
    this.snapshot.budget = structuredClone(value)
    this.touch()
  }

  pause(reason: RunPauseReason, message: string): void {
    this.snapshot.status = reason === 'budget' ? 'paused_budget' : reason === 'cancelled' ? 'cancelled' : 'failed'
    this.snapshot.pauseReason = reason
    this.snapshot.error = message
    this.touch()
  }

  complete(): void {
    if (!this.isTerminal()) {
      this.snapshot.status = 'completed'
      this.touch()
    }
  }

  fail(message: string): void {
    this.pause('error', message)
  }

  isTerminal(): boolean {
    return this.snapshot.status === 'completed' || this.snapshot.status === 'failed' || this.snapshot.status === 'cancelled' || this.snapshot.status === 'paused_budget' || this.snapshot.status === 'interrupted'
  }

  private touch(): void {
    this.snapshot.updatedAt = this.now()
  }
}
