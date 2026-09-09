/** 官方思考强度映射：值解析与点路径写入。 */

/**
 * 禁止写入的键：
 * - 原型链相关（`__proto__` / `constructor` / `prototype`），避免用户自填路径污染 Object.prototype；
 * - 协议请求体自身字段（`model` / `messages` / `stream` 等），OpenAI 兼容适配器会把映射展开在最后，
 *   允许这些键就等于让映射覆盖模型名与消息体。
 */
export const RESERVED_REASONING_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'model',
  'messages',
  'stream',
  'stream_options',
  'tools',
  'system',
  'contents',
  'systemInstruction',
  'max_tokens',
  'max_completion_tokens'
])

/** 路径可写入：非空、无空段、不含保留键。 */
export function isWritableReasoningPath(path: string): boolean {
  const segments = path.split('.').map((s) => s.trim())
  return segments.length > 0 && segments.every((s) => Boolean(s) && !RESERVED_REASONING_KEYS.has(s))
}

/**
 * 空/空白 → undefined；先按 JSON 解析（2048 / true / "low"），
 * 失败则按裸字符串（low → 'low'），这样用户不必给字符串加引号。
 * JSON `null` 视为「没填」，避免把 null 当参数值发出去。
 */
export function parseReasoningValue(raw?: string): unknown | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed === null ? undefined : parsed
  } catch {
    return text
  }
}

/** 按点路径逐级建对象写入；路径不可写入时忽略。已有同级字段不会被清空。 */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  if (!isWritableReasoningPath(path)) return
  const segments = path.split('.').map((s) => s.trim())
  let cursor = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]
    const next = cursor[key]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}
