/** 模型参数下拉的候选值与展示格式。 */
export const CONTEXT_PRESETS = [32768, 131072, 278528, 1048576]
export const OUTPUT_PRESETS = [4096, 8192, 16384, 32768]

/** 预设 + 档案默认值合并去重（档案值可能不在预设里，例如 Claude 的 64K）。 */
export function modelParamOptions(presets: number[], fallback: number, current?: number): number[] {
  const values = new Set(presets)
  if (Number.isFinite(fallback) && fallback > 0) values.add(fallback)
  if (current !== undefined && Number.isFinite(current) && current > 0) values.add(current)
  return [...values].sort((a, b) => a - b)
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1048576) return `${Math.round((value / 1048576) * 10) / 10}M`
  return `${Math.round(value / 1024)}K`
}
