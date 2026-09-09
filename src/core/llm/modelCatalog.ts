import type { ModelSettings, ReasoningLevel } from '../../shared/types'
import type { ModelParams } from './types'

/** 模型能力档案：只用于「默认值」与「参数形式」，用户可逐模型覆盖。 */
export interface ModelProfile {
  /** 便于调试/展示的家族标签 */
  label: string
  contextTokens: number
  maxOutputTokens: number
  /** OpenAI 兼容协议应使用的输出上限字段名 */
  openaiOutputParam: 'max_tokens' | 'max_completion_tokens'
  /** 是否支持推理等级（具体参数形式由协议决定） */
  reasoning: boolean
  /** 是否支持图片输入（仅作开关初值，用户可覆盖） */
  vision: boolean
}

export type ResolvedModelSettings = ModelParams

const GENERIC: ModelProfile = {
  label: '通用',
  contextTokens: 131072,
  maxOutputTokens: 8192,
  openaiOutputParam: 'max_tokens',
  reasoning: false,
  vision: false
}

/** 顺序敏感：先匹配到的生效。数值取自公开资料，默认取**该型号的真实上限**，宁保守不激进。 */
const PROFILES: Array<{ test: RegExp; profile: ModelProfile }> = [
  {
    test: /^gpt-5/,
    profile: { label: 'GPT-5', contextTokens: 400000, maxOutputTokens: 128000, openaiOutputParam: 'max_completion_tokens', reasoning: true, vision: true }
  },
  {
    test: /^o[1-9]/,
    profile: { label: 'OpenAI 推理模型', contextTokens: 200000, maxOutputTokens: 100000, openaiOutputParam: 'max_completion_tokens', reasoning: true, vision: false }
  },
  {
    test: /^gpt-4\.1/,
    profile: { label: 'GPT-4.1', contextTokens: 1048576, maxOutputTokens: 32768, openaiOutputParam: 'max_tokens', reasoning: false, vision: true }
  },
  {
    test: /^gpt-4o/,
    profile: { label: 'GPT-4o', contextTokens: 131072, maxOutputTokens: 16384, openaiOutputParam: 'max_tokens', reasoning: false, vision: true }
  },
  {
    test: /^gpt-4/,
    profile: { label: 'GPT-4', contextTokens: 131072, maxOutputTokens: 4096, openaiOutputParam: 'max_tokens', reasoning: false, vision: false }
  },
  {
    test: /^claude-opus-4/,
    profile: { label: 'Claude Opus 4', contextTokens: 200000, maxOutputTokens: 32000, openaiOutputParam: 'max_tokens', reasoning: true, vision: true }
  },
  {
    test: /^claude-3[-.]7/,
    profile: { label: 'Claude 3.7', contextTokens: 200000, maxOutputTokens: 64000, openaiOutputParam: 'max_tokens', reasoning: true, vision: true }
  },
  {
    test: /^claude-3-opus/,
    profile: { label: 'Claude 3 Opus', contextTokens: 200000, maxOutputTokens: 4096, openaiOutputParam: 'max_tokens', reasoning: false, vision: true }
  },
  {
    test: /^claude-3/,
    profile: { label: 'Claude 3', contextTokens: 200000, maxOutputTokens: 8192, openaiOutputParam: 'max_tokens', reasoning: false, vision: true }
  },
  {
    test: /^claude/,
    profile: { label: 'Claude', contextTokens: 200000, maxOutputTokens: 64000, openaiOutputParam: 'max_tokens', reasoning: true, vision: true }
  },
  {
    test: /^gemini-1\.5|^gemini-2\.0/,
    profile: { label: 'Gemini 1.5/2.0', contextTokens: 1048576, maxOutputTokens: 8192, openaiOutputParam: 'max_tokens', reasoning: false, vision: true }
  },
  {
    test: /^gemini-3/,
    profile: { label: 'Gemini 3', contextTokens: 1048576, maxOutputTokens: 64000, openaiOutputParam: 'max_tokens', reasoning: true, vision: true }
  },
  {
    test: /^gemini/,
    profile: { label: 'Gemini', contextTokens: 1048576, maxOutputTokens: 65536, openaiOutputParam: 'max_tokens', reasoning: true, vision: true }
  },
  {
    test: /^deepseek/,
    profile: { label: 'DeepSeek', contextTokens: 131072, maxOutputTokens: 8192, openaiOutputParam: 'max_tokens', reasoning: false, vision: false }
  },
  {
    test: /^kimi|^moonshot/,
    profile: { label: 'Kimi', contextTokens: 262144, maxOutputTokens: 16384, openaiOutputParam: 'max_tokens', reasoning: false, vision: false }
  },
  {
    test: /^qwen/,
    profile: { label: 'Qwen', contextTokens: 1048576, maxOutputTokens: 32768, openaiOutputParam: 'max_tokens', reasoning: false, vision: false }
  },
  {
    test: /^glm|^z-ai/,
    profile: { label: 'GLM', contextTokens: 131072, maxOutputTokens: 16384, openaiOutputParam: 'max_tokens', reasoning: false, vision: false }
  },
  {
    test: /^grok/,
    profile: { label: 'Grok', contextTokens: 131072, maxOutputTokens: 16384, openaiOutputParam: 'max_tokens', reasoning: false, vision: false }
  }
]

export function profileForModel(model: string): ModelProfile {
  const raw = (model ?? '').trim().toLowerCase()
  // 网关常带供应商前缀（openai/gpt-4o、anthropic/claude-*），只取最后一段做匹配
  const name = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
  for (const { test, profile } of PROFILES) {
    if (test.test(name)) return profile
  }
  return GENERIC
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

export function resolveModelSettings(
  provider: { modelSettings?: Record<string, ModelSettings> },
  model: string
): ResolvedModelSettings {
  const profile = profileForModel(model)
  const configured = provider.modelSettings?.[model] ?? {}
  return {
    reasoning: configured.reasoning ?? 'off',
    reasoningSupport: configured.reasoningSupport,
    reasoningMap: configured.reasoningMap,
    contextTokens: positiveNumber(configured.contextTokens) ?? profile.contextTokens,
    maxOutputTokens: positiveNumber(configured.maxOutputTokens) ?? profile.maxOutputTokens
  }
}

/** 只保留仍在模型列表里的参数覆盖，避免删除模型后残留脏数据。 */
export function pruneModelSettings(
  models: string[],
  settings: Record<string, ModelSettings> | undefined
): Record<string, ModelSettings> {
  const allowed = new Set(models)
  const out: Record<string, ModelSettings> = {}
  for (const [model, value] of Object.entries(settings ?? {})) {
    if (allowed.has(model)) out[model] = value
  }
  return out
}
