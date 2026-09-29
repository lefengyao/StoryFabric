/** 模型能力与模型清单的纯逻辑（UI 用，无副作用）。 */
import type { ModelSettings, Protocol, ReasoningLevel, ReasoningMap } from '../../../shared/types'
import { profileForModel } from '../../../core/llm/modelCatalog'
import { RESERVED_REASONING_KEYS } from '../../../core/llm/reasoningMap'

/** 用户声明优先，缺省回落到内置档案。 */
export function resolveCapability(model: string, settings?: ModelSettings): { reasoning: boolean; vision: boolean } {
  const profile = profileForModel(model)
  return {
    reasoning: settings?.reasoningSupport ?? profile.reasoning,
    vision: settings?.vision ?? profile.vision
  }
}

export function resolveContextWindow(model: string, settings?: ModelSettings): { contextTokens: number; maxOutputTokens: number } {
  const profile = profileForModel(model)
  const positive = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  return {
    contextTokens: positive(settings?.contextTokens, profile.contextTokens),
    maxOutputTokens: positive(settings?.maxOutputTokens, profile.maxOutputTokens)
  }
}

/** 合并添加：去空白、去重、保持顺序。 */
export function addModels(current: string[], incoming: string[]): string[] {
  const out = [...current]
  const seen = new Set(current)
  for (const raw of incoming) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function removeModel(current: string[], model: string): string[] {
  return current.filter((m) => m !== model)
}

/** 服务返回但尚未添加的模型：保持服务返回顺序并去重。 */
export function pendingModels(configured: string[], fetched: string[]): string[] {
  const have = new Set(configured)
  const seen = new Set<string>()
  return fetched.filter((m) => {
    if (have.has(m) || seen.has(m)) return false
    seen.add(m)
    return true
  })
}

export function filterModels(models: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  return q ? models.filter((m) => m.toLowerCase().includes(q)) : models
}

export function isValidModelName(name: string): boolean {
  const text = name.trim()
  return text.length > 0 && text.length <= 200 && !/[\r\n]/.test(text)
}

export function setMappingPath(map: ReasoningMap | undefined, path: string): ReasoningMap {
  return { path, values: { ...(map?.values ?? {}) } }
}

/** 写入某个等级的映射值；空白表示删除该等级。 */
export function setMappingValue(map: ReasoningMap | undefined, level: ReasoningLevel, value: string): ReasoningMap {
  const values = { ...(map?.values ?? {}) }
  if (value.trim()) values[level] = value
  else delete values[level]
  return { path: map?.path ?? '', values }
}

/** 返回提示文案；null 表示没有问题。protocol 用于提示该协议的可用参数形式。 */
export function mappingWarning(map?: ReasoningMap, protocol?: Protocol): string | null {
  if (!map) return null
  const path = (map.path ?? '').trim()
  const hasValue = Object.values(map.values ?? {}).some((v) => Boolean(v && v.trim()))
  if (!path) return hasValue ? '请先填写官方参数名' : null
  if (/\s/.test(path)) return '参数名里不能有空格'
  const reserved = path.split('.').map((s) => s.trim()).find((s) => RESERVED_REASONING_KEYS.has(s))
  if (reserved) return `「${reserved}」是请求体保留字段，不能映射`
  if (protocol === 'gemini' && !path.startsWith('generationConfig.')) return 'Gemini 的参数需以 generationConfig. 开头'
  if (protocol === 'anthropic' && path !== 'thinking') return 'Anthropic 只认 thinking，请直接映射 thinking 并填完整 JSON 对象'
  return null
}
