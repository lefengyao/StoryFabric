/** 模型能力与模型清单的纯逻辑（UI 用，无副作用）。 */
import type { ModelSettings, ReasoningLevel, ReasoningMap } from '../../../shared/types'
import { profileForModel } from '../../../core/llm/modelCatalog'

/** 用户声明优先，缺省回落到内置档案。 */
export function resolveCapability(model: string, settings?: ModelSettings): { reasoning: boolean; vision: boolean } {
  const profile = profileForModel(model)
  return {
    reasoning: settings?.reasoningSupport ?? profile.reasoning,
    vision: settings?.vision ?? profile.vision
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

/** 返回提示文案；null 表示没有问题。 */
export function mappingWarning(map?: ReasoningMap): string | null {
  if (!map) return null
  const path = map.path.trim()
  const hasValue = Object.values(map.values).some((v) => Boolean(v && v.trim()))
  if (!path) return hasValue ? '请先填写官方参数名' : null
  if (/\s/.test(path)) return '参数名里不能有空格'
  return null
}
