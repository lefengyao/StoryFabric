import { RunBudget, type BudgetOptions, type BudgetSeed, type BudgetSnapshot, type RunBudget as RunBudgetType } from './budget'
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
  maxAttempts?: number
  estimatedInputTokens: number
  maxOutputTokens: number
  execute: () => Promise<T & { usage?: TokenUsage }>
}

export class ModelCallBudgetError extends Error {
  readonly code = 'BUDGET_EXCEEDED'
  constructor(readonly reason: 'calls' | 'tokens', readonly snapshot?: BudgetSnapshot) {
    const dimension = reason === 'calls' ? '调用次数' : '估计 token'
    const detail = snapshot
      ? `（调用 ${snapshot.callsStarted}/${snapshot.maxCalls}；估算 Token ${snapshot.estimatedTokens + snapshot.reservedTokens}/${snapshot.maxEstimatedTokens}）`
      : ''
    super(`模型调用预算不足：${dimension}${detail}`)
  }
}

export class ModelCallGateway {
  readonly budget: RunBudgetType
  private readonly results = new Map<string, Promise<unknown>>()

  constructor(options: BudgetOptions, private readonly onUsage?: (record: UsageRecord) => void, seed?: BudgetSeed) {
    this.budget = new RunBudget(options, seed)
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
    if (!reservation.accepted) throw new ModelCallBudgetError(reservation.reason ?? 'calls', this.budget.snapshot())

    let result: (T & { usage?: TokenUsage }) | undefined
    let error: unknown
    let attempts = 0
    try {
      const maxAttempts = Math.max(1, Math.min(3, input.maxAttempts ?? 1))
      while (attempts < maxAttempts) {
        attempts += 1
        try {
          result = await input.execute()
          return result
        } catch (cause) {
          error = cause
          if (attempts >= maxAttempts || !isRetryableModelError(cause)) throw cause
        }
      }
      throw error instanceof Error ? error : new Error(String(error))
    } catch (cause) {
      error = cause
      throw cause
    } finally {
      const settlement = this.budget.settle({ callId: input.callId, usage: result?.usage, status: error ? 'failed' : 'completed' })
      if (result?.usage || error) this.onUsage?.({
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
        attempt: (input.attempt ?? attempts) || 1,
        status: error ? 'failed' : 'completed',
        usageSource: settlement.usageSource
      })
    }
  }
}

function isRetryableModelError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown }
  if (value.name === 'AbortError' || value.code === 'BUDGET_EXCEEDED') return false
  if (typeof value.status === 'number' && (value.status === 408 || value.status === 409 || value.status === 429 || value.status >= 500)) return true
  const marker = [value.code, value.name, value.message].filter((item): item is string => typeof item === 'string').join(' ')
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|TIMEOUT|429|5\d\d/u.test(marker)
}
