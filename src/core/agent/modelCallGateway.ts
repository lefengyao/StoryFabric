import { RunBudget, type BudgetOptions, type RunBudget as RunBudgetType } from './budget'
import type { TokenUsage } from '../llm/types'
import type { UsageRecord } from '../../shared/types'

export interface ModelCallInput<T> {
  callId: string
  runId: string
  stageId?: string
  agentId?: string
  parentAgentId?: string
  purpose: NonNullable<UsageRecord['purpose']>
  providerId?: string
  providerName?: string
  model?: string
  attempt?: number
  estimatedInputTokens: number
  maxOutputTokens: number
  execute: () => Promise<T & { usage?: TokenUsage }>
}

export class ModelCallBudgetError extends Error {
  readonly code = 'BUDGET_EXCEEDED'
  constructor(readonly reason: 'calls' | 'tokens') { super(`模型调用预算不足：${reason === 'calls' ? '调用次数' : '估计 token'}`) }
}

export class ModelCallGateway {
  readonly budget: RunBudgetType
  private readonly results = new Map<string, Promise<unknown>>()

  constructor(options: BudgetOptions, private readonly onUsage?: (record: UsageRecord) => void) {
    this.budget = new RunBudget(options)
  }

  async call<T>(input: ModelCallInput<T>): Promise<T & { usage?: TokenUsage }> {
    const previous = this.results.get(input.callId)
    if (previous) return previous as Promise<T & { usage?: TokenUsage }>
    const current = this.execute(input)
    this.results.set(input.callId, current)
    return current
  }

  private async execute<T>(input: ModelCallInput<T>): Promise<T & { usage?: TokenUsage }> {
    const reservation = await this.budget.reserve({ callId: input.callId, estimatedInputTokens: input.estimatedInputTokens, maxOutputTokens: input.maxOutputTokens })
    if (!reservation.accepted) throw new ModelCallBudgetError(reservation.reason ?? 'calls')

    let result: (T & { usage?: TokenUsage }) | undefined
    let error: unknown
    try {
      result = await input.execute()
      return result
    } catch (cause) {
      error = cause
      throw cause
    } finally {
      const settlement = this.budget.settle({ callId: input.callId, usage: result?.usage, status: error ? 'failed' : 'completed' })
      this.onUsage?.({
        at: Date.now(),
        providerId: input.providerId ?? 'unknown',
        providerName: input.providerName ?? input.providerId ?? 'unknown',
        model: input.model ?? 'unknown',
        promptTokens: result?.usage?.promptTokens ?? input.estimatedInputTokens,
        completionTokens: result?.usage?.completionTokens ?? 0,
        cachedTokens: result?.usage?.cachedTokens ?? 0,
        cacheWriteTokens: result?.usage?.cacheWriteTokens ?? 0,
        callId: input.callId,
        runId: input.runId,
        stageId: input.stageId,
        agentId: input.agentId,
        parentAgentId: input.parentAgentId,
        purpose: input.purpose,
        attempt: input.attempt ?? 1,
        status: error ? 'failed' : 'completed',
        usageSource: settlement.usageSource
      })
    }
  }
}
