/** 官方思考强度映射：值解析与点路径写入。 */

/**
 * 空/空白 → undefined；先按 JSON 解析（2048 / true / "low"），
 * 失败则按裸字符串（low → 'low'），这样用户不必给字符串加引号。
 */
export function parseReasoningValue(raw?: string): unknown | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** 按点路径逐级建对象写入；路径为空或含空段时忽略。已有同级字段不会被清空。 */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').map((s) => s.trim())
  if (segments.some((s) => !s)) return
  let cursor = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]
    const next = cursor[key]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}
