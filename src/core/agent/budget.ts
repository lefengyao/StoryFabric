export interface BudgetOptions {
  maxCalls: number
  maxEstimatedTokens: number
}

export interface BudgetSeed {
  callsStarted?: number
  callsSettled?: number
  actualTokens?: number
  estimatedTokens?: number
}

export interface ReservationInput {
  callId: string
  estimatedInputTokens: number
  maxOutputTokens: number
}

export interface ReservationResult {
  accepted: boolean
  reason?: 'calls' | 'tokens'
  existing?: boolean
}

export interface SettlementInput {
  callId: string
  usage?: { promptTokens: number; completionTokens: number }
  status?: 'completed' | 'failed' | 'cancelled'
}

export interface SettlementResult {
  usageSource: 'actual' | 'estimated' | 'missing'
  estimatedTokens: number
  actualTokens: number
}

export interface BudgetSnapshot {
  maxCalls: number
  maxEstimatedTokens: number
  callsStarted: number
  callsSettled: number
  actualTokens: number
  estimatedTokens: number
  reservedTokens: number
}

interface Reservation {
  estimate: number
  settled: boolean
  actualTokens: number
}

function validPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

export class RunBudget {
  private readonly reservations = new Map<string, Reservation>()
  private callsStarted = 0
  private callsSettled = 0
  private actualTokens = 0
  private estimatedTokens = 0
  private reservedTokens = 0

  constructor(private readonly options: BudgetOptions, seed: BudgetSeed = {}) {
    if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1) throw new Error('maxCalls 必须是正整数')
    if (!Number.isInteger(options.maxEstimatedTokens) || options.maxEstimatedTokens < 1) throw new Error('maxEstimatedTokens 必须是正整数')
    this.callsStarted = Math.max(0, Math.floor(seed.callsStarted ?? 0))
    this.callsSettled = Math.max(0, Math.min(this.callsStarted, Math.floor(seed.callsSettled ?? this.callsStarted)))
    this.actualTokens = Math.max(0, Math.floor(seed.actualTokens ?? 0))
    this.estimatedTokens = Math.max(0, Math.floor(seed.estimatedTokens ?? 0))
  }

  async reserve(input: ReservationInput): Promise<ReservationResult> {
    const existing = this.reservations.get(input.callId)
    if (existing) return { accepted: true, existing: true }
    if (!input.callId || !validPositiveInteger(input.estimatedInputTokens) || !validPositiveInteger(input.maxOutputTokens)) throw new Error('预算预留参数无效')
    const estimate = input.estimatedInputTokens + input.maxOutputTokens
    if (this.callsStarted >= this.options.maxCalls) return { accepted: false, reason: 'calls' }
    if (this.estimatedTokens + this.reservedTokens + estimate > this.options.maxEstimatedTokens) return { accepted: false, reason: 'tokens' }
    this.reservations.set(input.callId, { estimate, settled: false, actualTokens: 0 })
    this.callsStarted += 1
    this.reservedTokens += estimate
    return { accepted: true }
  }

  settle(input: SettlementInput): SettlementResult {
    const reservation = this.reservations.get(input.callId)
    if (!reservation) throw new Error('未找到预算预留')
    if (reservation.settled) {
      const usageSource = reservation.actualTokens > 0 ? 'actual' : 'missing'
      return { usageSource, estimatedTokens: reservation.estimate, actualTokens: reservation.actualTokens }
    }
    reservation.settled = true
    this.callsSettled += 1
    this.reservedTokens -= reservation.estimate
    const actualTokens = input.usage && validPositiveInteger(input.usage.promptTokens) && validPositiveInteger(input.usage.completionTokens)
      ? input.usage.promptTokens + input.usage.completionTokens
      : 0
    reservation.actualTokens = actualTokens
    if (actualTokens > 0) {
      this.actualTokens += actualTokens
      this.estimatedTokens += actualTokens
      return { usageSource: 'actual', estimatedTokens: reservation.estimate, actualTokens }
    }
    // 没有供应商 usage 时保留估计额度，避免把未知成本当作免费。
    this.estimatedTokens += reservation.estimate
    return { usageSource: input.usage ? 'estimated' : 'missing', estimatedTokens: reservation.estimate, actualTokens: 0 }
  }

  snapshot(): BudgetSnapshot {
    return {
      ...this.options,
      callsStarted: this.callsStarted,
      callsSettled: this.callsSettled,
      actualTokens: this.actualTokens,
      estimatedTokens: this.estimatedTokens,
      reservedTokens: this.reservedTokens
    }
  }
}
