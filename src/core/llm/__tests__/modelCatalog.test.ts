import { describe, expect, it } from 'vitest'
import { profileForModel, resolveModelSettings } from '../modelCatalog'

describe('profileForModel', () => {
  it('识别推理模型家族：用 max_completion_tokens 且支持 reasoning', () => {
    for (const model of ['o3-mini', 'o4-mini', 'gpt-5', 'gpt-5.1-codex', 'GPT-5.6-Sol']) {
      const profile = profileForModel(model)
      expect(profile.openaiOutputParam).toBe('max_completion_tokens')
      expect(profile.reasoning).toBe(true)
    }
  })

  it('识别普通 OpenAI 模型：用 max_tokens 且无 reasoning', () => {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4-turbo']) {
      const profile = profileForModel(model)
      expect(profile.openaiOutputParam).toBe('max_tokens')
      expect(profile.reasoning).toBe(false)
    }
  })

  it('识别 Claude / Gemini / DeepSeek / Kimi / Qwen', () => {
    expect(profileForModel('claude-sonnet-4-5').reasoning).toBe(true)
    expect(profileForModel('claude-sonnet-4-5').contextTokens).toBe(200000)
    expect(profileForModel('gemini-2.5-pro').reasoning).toBe(true)
    expect(profileForModel('gemini-2.5-pro').contextTokens).toBe(1048576)
    expect(profileForModel('deepseek-reasoner').reasoning).toBe(false)
    expect(profileForModel('deepseek-reasoner').contextTokens).toBe(131072)
    expect(profileForModel('kimi-k2-0905').contextTokens).toBe(262144)
    expect(profileForModel('qwen3-max').contextTokens).toBe(1048576)
  })

  it('旧型号取保守输出上限，避免默认值超过真实限制', () => {
    expect(profileForModel('claude-3-5-sonnet-latest').maxOutputTokens).toBe(8192)
    expect(profileForModel('claude-3-opus-20240229').maxOutputTokens).toBe(4096)
    expect(profileForModel('gpt-4-turbo').maxOutputTokens).toBe(4096)
    expect(profileForModel('gemini-2.0-flash').maxOutputTokens).toBe(8192)
    expect(profileForModel('gemini-2.0-flash').reasoning).toBe(false)
    expect(profileForModel('gemini-1.5-pro').reasoning).toBe(false)
  })

  it('识别网关前缀（openai/gpt-4o、anthropic/claude-*）', () => {
    expect(profileForModel('openai/gpt-4o').maxOutputTokens).toBe(16384)
    expect(profileForModel('anthropic/claude-sonnet-4-5').maxOutputTokens).toBe(64000)
    expect(profileForModel('google/gemini-2.5-pro').reasoning).toBe(true)
  })

  it('未知模型回落到通用档案（128K / 8K / max_tokens / 无 reasoning）', () => {
    const profile = profileForModel('some-local-model')
    expect(profile.contextTokens).toBe(131072)
    expect(profile.maxOutputTokens).toBe(8192)
    expect(profile.openaiOutputParam).toBe('max_tokens')
    expect(profile.reasoning).toBe(false)
  })

  it('模型名大小写不敏感', () => {
    expect(profileForModel('CLAUDE-SONNET-4').contextTokens).toBe(profileForModel('claude-sonnet-4').contextTokens)
  })
})

describe('resolveModelSettings', () => {
  it('未配置时取模型档案默认值', () => {
    const resolved = resolveModelSettings({}, 'claude-sonnet-4-5')
    expect(resolved).toEqual({ reasoning: 'off', contextTokens: 200000, maxOutputTokens: 64000 })
  })

  it('用户配置覆盖档案', () => {
    const resolved = resolveModelSettings(
      { modelSettings: { 'claude-sonnet-4-5': { reasoning: 'high', contextTokens: 1048576, maxOutputTokens: 32768 } } },
      'claude-sonnet-4-5'
    )
    expect(resolved).toEqual({ reasoning: 'high', contextTokens: 1048576, maxOutputTokens: 32768 })
  })

  it('只覆盖部分字段时其余取档案值', () => {
    const resolved = resolveModelSettings({ modelSettings: { 'gpt-4o': { maxOutputTokens: 4096 } } }, 'gpt-4o')
    expect(resolved).toEqual({ reasoning: 'off', contextTokens: 131072, maxOutputTokens: 4096 })
  })

  it('非法数值被忽略', () => {
    const resolved = resolveModelSettings(
      { modelSettings: { 'gpt-4o': { contextTokens: 0, maxOutputTokens: Number.NaN } } },
      'gpt-4o'
    )
    expect(resolved.contextTokens).toBe(131072)
    expect(resolved.maxOutputTokens).toBe(16384)
  })
})
