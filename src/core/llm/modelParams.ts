/** 把「模型档案 + 用户覆盖」翻译成各协议的请求体片段。 */
import type { Protocol, ReasoningLevel } from '../../shared/types'
import { profileForModel, type ResolvedModelSettings } from './modelCatalog'

const BUDGETS: Record<Exclude<ReasoningLevel, 'off'>, number> = { low: 2048, medium: 8192, high: 16384 }

/**
 * Anthropic 要求 max_tokens > budget_tokens，因此预算以用户设定的输出上限为准。
 * off 返回 0；其余至少 1024。
 */
export function reasoningBudget(level: ReasoningLevel, maxOutputTokens: number): number {
  if (level === 'off') return 0
  return Math.max(1024, Math.min(BUDGETS[level], maxOutputTokens - 1024))
}

export function buildModelParams(protocol: Protocol, model: string, params: ResolvedModelSettings): Record<string, unknown> {
  const profile = profileForModel(model)
  const reasoningOn = profile.reasoning && params.reasoning !== 'off'
  const budget = profile.reasoning ? reasoningBudget(params.reasoning, params.maxOutputTokens) : 0

  if (protocol === 'anthropic') {
    return {
      max_tokens: params.maxOutputTokens,
      ...(reasoningOn ? { thinking: { type: 'enabled', budget_tokens: budget } } : {})
    }
  }
  if (protocol === 'gemini') {
    return {
      generationConfig: {
        maxOutputTokens: params.maxOutputTokens,
        ...(profile.reasoning ? { thinkingConfig: { thinkingBudget: reasoningOn ? budget : 0 } } : {})
      }
    }
  }
  return {
    [profile.openaiOutputParam]: params.maxOutputTokens,
    ...(reasoningOn ? { reasoning_effort: params.reasoning } : {})
  }
}
