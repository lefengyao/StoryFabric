import { describe, expect, it } from 'vitest'
import { buildModelParams, reasoningBudget } from '../modelParams'

const params = (patch: Partial<{ reasoning: 'off' | 'low' | 'medium' | 'high'; contextTokens: number; maxOutputTokens: number }> = {}) => ({
  reasoning: 'off' as const,
  contextTokens: 131072,
  maxOutputTokens: 8192,
  ...patch
})

describe('reasoningBudget', () => {
  it('按等级给出预算，并保证不超过用户设定的输出上限', () => {
    expect(reasoningBudget('low', 8192)).toBe(2048)
    expect(reasoningBudget('medium', 8192)).toBe(7168)
    expect(reasoningBudget('high', 8192)).toBe(7168)
    expect(reasoningBudget('high', 4096)).toBe(3072)
    expect(reasoningBudget('off', 8192)).toBe(0)
  })

  it('输出上限过小时返回 0，避免 max_tokens 不大于 budget_tokens', () => {
    expect(reasoningBudget('high', 1024)).toBe(0)
    expect(reasoningBudget('high', 2048)).toBe(1024)
  })
})

describe('buildModelParams', () => {
  it('OpenAI 普通模型只带 max_tokens', () => {
    expect(buildModelParams('openai', 'gpt-4o', params({ reasoning: 'high' }))).toEqual({ max_tokens: 8192 })
  })

  it('OpenAI 推理模型用 max_completion_tokens 并带 reasoning_effort', () => {
    expect(buildModelParams('openai', 'o3-mini', params({ reasoning: 'high' }))).toEqual({
      max_completion_tokens: 8192,
      reasoning_effort: 'high'
    })
    expect(buildModelParams('openai', 'o3-mini', params())).toEqual({ max_completion_tokens: 8192 })
  })

  it('Anthropic 始终带 max_tokens，开启推理时附带 thinking 预算', () => {
    expect(buildModelParams('anthropic', 'claude-sonnet-4-5', params())).toEqual({ max_tokens: 8192 })
    expect(buildModelParams('anthropic', 'claude-sonnet-4-5', params({ reasoning: 'medium' }))).toEqual({
      max_tokens: 8192,
      thinking: { type: 'enabled', budget_tokens: 7168 }
    })
  })

  it('Anthropic 的输出上限优先于推理预算', () => {
    const built = buildModelParams('anthropic', 'claude-sonnet-4-5', params({ reasoning: 'high', maxOutputTokens: 4096 }))
    expect(built).toEqual({ max_tokens: 4096, thinking: { type: 'enabled', budget_tokens: 3072 } })
  })

  it('输出上限不足以容纳推理预算时不发送 thinking', () => {
    expect(buildModelParams('anthropic', 'claude-sonnet-4-5', params({ reasoning: 'high', maxOutputTokens: 1024 }))).toEqual({
      max_tokens: 1024
    })
  })

  it('Gemini 走 generationConfig，关闭推理时 thinkingBudget 为 0', () => {
    expect(buildModelParams('gemini', 'gemini-2.5-pro', params({ reasoning: 'low' }))).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 2048 } }
    })
    expect(buildModelParams('gemini', 'gemini-2.5-pro', params())).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } }
    })
  })

  it('档案不支持推理的模型即使选了等级也不发推理参数', () => {
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high' }))).toEqual({ max_tokens: 8192 })
    expect(buildModelParams('gemini', 'some-local-model', params({ reasoning: 'high' }))).toEqual({
      generationConfig: { maxOutputTokens: 8192 }
    })
  })
})
