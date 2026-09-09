/** 把「模型档案 + 用户覆盖」翻译成各协议的请求体片段。 */
import type { Protocol, ReasoningLevel } from '../../shared/types'
import { profileForModel, type ResolvedModelSettings } from './modelCatalog'
import { isWritableReasoningPath, parseReasoningValue, setByPath } from './reasoningMap'

const BUDGETS: Record<Exclude<ReasoningLevel, 'off'>, number> = { low: 2048, medium: 8192, high: 16384 }

/**
 * Anthropic 要求 max_tokens > budget_tokens ≥ 1024，因此预算以用户设定的输出上限为准。
 * off、或输出上限留不出 ≥1024 的预算空间时返回 0（调用方据此不发送推理参数）。
 */
export function reasoningBudget(level: ReasoningLevel, maxOutputTokens: number): number {
  if (level === 'off') return 0
  const room = maxOutputTokens - 1024
  if (room < 1024) return 0
  return Math.min(BUDGETS[level], room)
}

export function buildModelParams(protocol: Protocol, model: string, params: ResolvedModelSettings): Record<string, unknown> {
  const profile = profileForModel(model)
  // 用户明确表态优先；未表态时回落到档案
  const support = params.reasoningSupport ?? profile.reasoning

  // 映射优先：用户填了当前等级的值就用它，并跳过协议内置推理参数。
  // 只有用户明确关闭（false）时才连同映射一起禁用；未表态时映射本身即用户意图。
  const rawPath = params.reasoningSupport === false ? undefined : params.reasoningMap?.path?.trim()
  const mappedPath = rawPath && isWritableReasoningPath(rawPath) ? rawPath : undefined
  const mappedValue = mappedPath ? parseReasoningValue(params.reasoningMap?.values?.[params.reasoning]) : undefined
  const useMap = Boolean(mappedPath) && mappedValue !== undefined

  const budget = support && !useMap ? reasoningBudget(params.reasoning, params.maxOutputTokens) : 0
  const reasoningOn = budget > 0

  const body: Record<string, unknown> =
    protocol === 'anthropic'
      ? { max_tokens: params.maxOutputTokens }
      : protocol === 'gemini'
        ? { generationConfig: { maxOutputTokens: params.maxOutputTokens } }
        : { [profile.openaiOutputParam]: params.maxOutputTokens }

  if (useMap) {
    setByPath(body, mappedPath as string, mappedValue)
    // 输出上限始终以用户设置为准，避免映射路径把它改坏
    if (protocol === 'gemini') {
      const config = body.generationConfig
      if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
        ;(config as Record<string, unknown>).maxOutputTokens = params.maxOutputTokens
      } else {
        // 映射把 generationConfig 整个替换成了标量：重建它，保住输出上限
        body.generationConfig = { maxOutputTokens: params.maxOutputTokens }
      }
    } else if (protocol === 'anthropic') {
      body.max_tokens = params.maxOutputTokens
    } else {
      body[profile.openaiOutputParam] = params.maxOutputTokens
    }
  } else if (reasoningOn) {
    if (protocol === 'anthropic') {
      body.thinking = { type: 'enabled', budget_tokens: budget }
    } else if (protocol === 'gemini') {
      ;(body.generationConfig as Record<string, unknown>).thinkingConfig = { thinkingBudget: budget }
    } else {
      body.reasoning_effort = params.reasoning
    }
  }

  return body
}
