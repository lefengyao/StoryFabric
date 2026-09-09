import { describe, expect, it } from 'vitest'
import { buildModelParams, reasoningBudget } from '../modelParams'
import type { ReasoningLevel, ReasoningMap } from '../../../shared/types'

const params = (
  patch: Partial<{
    reasoning: ReasoningLevel
    reasoningSupport: boolean
    reasoningMap: ReasoningMap
    contextTokens: number
    maxOutputTokens: number
  }> = {}
) => ({
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

  it('Gemini 走 generationConfig；关闭推理时整个省略 thinkingConfig（2.5 Pro 拒绝 budget 0）', () => {
    expect(buildModelParams('gemini', 'gemini-2.5-pro', params({ reasoning: 'low' }))).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 2048 } }
    })
    expect(buildModelParams('gemini', 'gemini-2.5-pro', params())).toEqual({
      generationConfig: { maxOutputTokens: 8192 }
    })
  })

  it('档案不支持推理的模型即使选了等级也不发推理参数', () => {
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high' }))).toEqual({ max_tokens: 8192 })
    expect(buildModelParams('gemini', 'some-local-model', params({ reasoning: 'high' }))).toEqual({
      generationConfig: { maxOutputTokens: 8192 }
    })
  })

  it('用户声明不支持拓展思考时，即使档案支持也不发推理参数', () => {
    expect(buildModelParams('openai', 'o3-mini', params({ reasoning: 'high', reasoningSupport: false }))).toEqual({
      max_completion_tokens: 8192
    })
    expect(buildModelParams('anthropic', 'claude-sonnet-4-5', params({ reasoning: 'high', reasoningSupport: false }))).toEqual({
      max_tokens: 8192
    })
  })

  it('用户声明支持拓展思考时，档案说不支持也照样发', () => {
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high', reasoningSupport: true }))).toEqual({
      max_tokens: 8192,
      reasoning_effort: 'high'
    })
  })

  it('填了映射就用映射，且不再附加协议内置推理参数', () => {
    const map: ReasoningMap = { path: 'enable_thinking', values: { low: 'true', medium: 'true', high: 'true' } }
    expect(
      buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high', reasoningSupport: true, reasoningMap: map }))
    ).toEqual({ max_tokens: 8192, enable_thinking: true })
  })

  it('映射支持嵌套路径与数字值', () => {
    const map: ReasoningMap = { path: 'generationConfig.thinkingConfig.thinkingBudget', values: { high: '4096' } }
    expect(buildModelParams('gemini', 'gemini-2.5-pro', params({ reasoning: 'high', reasoningMap: map }))).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 4096 } }
    })
  })

  it('映射缺当前等级时回落到内置形式', () => {
    const map: ReasoningMap = { path: 'enable_thinking', values: { high: 'true' } }
    expect(buildModelParams('openai', 'o3-mini', params({ reasoning: 'low', reasoningMap: map }))).toEqual({
      max_completion_tokens: 8192,
      reasoning_effort: 'low'
    })
  })

  it('关闭推理时：映射填了「关」就发该值，没填就完全不发', () => {
    const withOff: ReasoningMap = { path: 'enable_thinking', values: { off: 'false' } }
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoningSupport: true, reasoningMap: withOff }))).toEqual({
      max_tokens: 8192,
      enable_thinking: false
    })
    const withoutOff: ReasoningMap = { path: 'enable_thinking', values: { high: 'true' } }
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoningSupport: true, reasoningMap: withoutOff }))).toEqual({
      max_tokens: 8192
    })
  })

  it('用户明确关闭时不使用映射', () => {
    const map: ReasoningMap = { path: 'enable_thinking', values: { off: 'false', high: 'true' } }
    expect(
      buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high', reasoningSupport: false, reasoningMap: map }))
    ).toEqual({ max_tokens: 8192 })
    // 档案说支持、用户明确关闭：映射同样不发
    expect(
      buildModelParams('openai', 'o3-mini', params({ reasoning: 'high', reasoningSupport: false, reasoningMap: map }))
    ).toEqual({ max_completion_tokens: 8192 })
  })

  it('用户没表态时映射本身即用户意图，不被档案默认值压制', () => {
    const map: ReasoningMap = { path: 'enable_thinking', values: { high: 'true' } }
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high', reasoningMap: map }))).toEqual({
      max_tokens: 8192,
      enable_thinking: true
    })
  })

  it('映射缺少 values 字段时不抛错，回落到内置形式', () => {
    const broken = { path: 'enable_thinking' } as unknown as ReasoningMap
    expect(buildModelParams('openai', 'o3-mini', params({ reasoning: 'low', reasoningMap: broken }))).toEqual({
      max_completion_tokens: 8192,
      reasoning_effort: 'low'
    })
  })

  it('映射路径命中保留字段时忽略映射，回落到内置形式', () => {
    const map: ReasoningMap = { path: 'max_tokens', values: { low: '1' } }
    expect(buildModelParams('openai', 'o3-mini', params({ reasoning: 'low', reasoningMap: map }))).toEqual({
      max_completion_tokens: 8192,
      reasoning_effort: 'low'
    })
  })

  it('关闭推理时 Anthropic / Gemini 也能发映射里的「关」值', () => {
    const off: ReasoningMap = { path: 'thinking.type', values: { off: 'disabled' } }
    expect(buildModelParams('anthropic', 'claude-sonnet-4-5', params({ reasoningMap: off }))).toEqual({
      max_tokens: 8192,
      thinking: { type: 'disabled' }
    })
    const geminiOff: ReasoningMap = { path: 'generationConfig.thinkingConfig.thinkingBudget', values: { off: '0' } }
    expect(buildModelParams('gemini', 'gemini-2.5-flash', params({ reasoningMap: geminiOff }))).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } }
    })
  })

  it('映射把输出上限改坏时，以用户设定的输出上限为准', () => {
    const map: ReasoningMap = { path: 'generationConfig.maxOutputTokens', values: { high: '1' } }
    expect(buildModelParams('gemini', 'gemini-2.5-pro', params({ reasoning: 'high', reasoningMap: map }))).toEqual({
      generationConfig: { maxOutputTokens: 8192 }
    })
  })
})
