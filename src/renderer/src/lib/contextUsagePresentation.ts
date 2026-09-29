export interface ContextUsagePresentation {
  ratio: number
  percent: number
  remainingTokens: number
  tone: 'accent' | 'gold' | 'danger'
}

export function resolveContextUsagePresentation(usedTokens: number, contextTokens: number): ContextUsagePresentation {
  const used = Math.max(0, Number.isFinite(usedTokens) ? usedTokens : 0)
  const limit = Math.max(1, Number.isFinite(contextTokens) ? contextTokens : 1)
  const ratio = Math.min(1, used / limit)
  return {
    ratio,
    percent: Math.round(ratio * 100),
    remainingTokens: Math.max(0, limit - used),
    tone: ratio >= 0.9 ? 'danger' : ratio >= 0.72 ? 'gold' : 'accent'
  }
}
