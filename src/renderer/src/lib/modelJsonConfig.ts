/** Human-editable, versioned JSON for one model's complete effective settings. */
import { profileForModel } from '../../../core/llm/modelCatalog'
import { isWritableReasoningPath } from '../../../core/llm/reasoningMap'
import type { ModelSettings, Protocol, ReasoningLevel, ReasoningMap } from '../../../shared/types'
import { mappingWarning, resolveContextWindow } from './modelCapability'

const FIELDS = ['schemaVersion', 'reasoningSupport', 'vision', 'reasoning', 'reasoningMap', 'contextTokens', 'maxOutputTokens'] as const
const LEVELS: ReasoningLevel[] = ['off', 'low', 'medium', 'high']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key))
  if (extra) throw new Error(`${label}包含不支持的字段：${extra}`)
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} 必须是 true 或 false`)
  return value
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`)
  return value
}

function parseReasoningMap(value: unknown, protocol: Protocol): ReasoningMap | undefined {
  if (value === null) return undefined
  if (!isRecord(value)) throw new Error('reasoningMap 必须是 null 或包含 path、values 的对象')
  rejectUnknown(value, ['path', 'values'], 'reasoningMap')
  if (typeof value.path !== 'string' || !isWritableReasoningPath(value.path)) throw new Error('reasoningMap.path 不是有效的请求参数路径')
  if (!isRecord(value.values)) throw new Error('reasoningMap.values 必须是对象')
  rejectUnknown(value.values, LEVELS, 'reasoningMap.values')
  const values: ReasoningMap['values'] = {}
  for (const level of LEVELS) {
    const raw = value.values[level]
    if (raw === undefined) continue
    if (typeof raw !== 'string') throw new Error(`reasoningMap.values.${level} 必须是字符串`)
    if (raw.trim()) values[level] = raw
  }
  if (Object.keys(values).length === 0) throw new Error('reasoningMap.values 至少填写一个思考强度；不使用映射时请填 null')
  const map = { path: value.path, values }
  const warning = mappingWarning(map, protocol)
  if (warning) throw new Error(`reasoningMap：${warning}`)
  return map
}

/** The displayed JSON includes profile defaults, so every configurable field is visible. */
export function formatModelConfigJson(model: string, settings: ModelSettings): string {
  const profile = profileForModel(model)
  const limits = resolveContextWindow(model, settings)
  const map = settings.reasoningMap
  const hasMapping = Boolean(map && ((map.path ?? '').trim() || Object.values(map.values ?? {}).some((value) => typeof value === 'string' && value.trim())))
  return JSON.stringify({
    schemaVersion: 1,
    reasoningSupport: settings.reasoningSupport ?? profile.reasoning,
    vision: settings.vision ?? profile.vision,
    reasoning: settings.reasoning ?? 'off',
    reasoningMap: hasMapping ? map : null,
    contextTokens: limits.contextTokens,
    maxOutputTokens: limits.maxOutputTokens
  }, null, 2)
}

/** Replaces one model's settings only after the whole JSON document passes validation. */
export function parseModelConfigJson(source: string, protocol: Protocol): ModelSettings {
  if (source.length > 64_000) throw new Error('JSON 配置不能超过 64000 字符')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('不是有效 JSON，请检查引号、逗号和括号')
  }
  if (!isRecord(parsed)) throw new Error('模型配置必须是 JSON 对象')
  rejectUnknown(parsed, FIELDS, '模型配置')
  if (parsed.schemaVersion !== 1) throw new Error('schemaVersion 必须为 1')
  const reasoningSupport = requiredBoolean(parsed.reasoningSupport, 'reasoningSupport')
  const vision = requiredBoolean(parsed.vision, 'vision')
  if (!LEVELS.includes(parsed.reasoning as ReasoningLevel)) throw new Error('reasoning 必须是 off、low、medium 或 high')
  if (!Object.prototype.hasOwnProperty.call(parsed, 'reasoningMap')) throw new Error('reasoningMap 必须填写 null 或映射对象')
  const reasoningMap = parseReasoningMap(parsed.reasoningMap, protocol)
  const contextTokens = positiveInteger(parsed.contextTokens, 'contextTokens')
  const maxOutputTokens = positiveInteger(parsed.maxOutputTokens, 'maxOutputTokens')
  if (maxOutputTokens > contextTokens) throw new Error('maxOutputTokens 不能大于 contextTokens')
  return {
    reasoningSupport,
    vision,
    reasoning: parsed.reasoning as ReasoningLevel,
    ...(reasoningMap ? { reasoningMap } : {}),
    contextTokens,
    maxOutputTokens
  }
}
