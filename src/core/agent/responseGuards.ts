/**
 * Models sometimes emit a progress promise instead of using the available
 * tools. Treat that as an incomplete turn so the caller can give it one
 * corrective retry instead of silently ending the session.
 */
export function isLikelyPlaceholderResponse(value: string | undefined): boolean {
  const text = value?.trim() ?? ''
  return /^(?:我(?:将|先|会|核实|确认|查看|检查|读取|查阅|分析)|准备|稍后|正在).{0,100}(?:读取|查阅|检查|分析|核实|确认|查看|核对|验证|落盘|工具)/u.test(text)
}
