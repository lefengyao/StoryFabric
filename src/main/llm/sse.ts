/** 极简 SSE 行解析器：从 fetch Response.body 逐行产出 */

export async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error('响应没有内容流')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        yield line
      }
    }
    if (buf.trim()) yield buf
  } finally {
    reader.releaseLock()
  }
}

/** 提取 "data:" 行负载；非数据行返回 null；[DONE] 原样返回 */
export function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null
  return line.slice(5).trim()
}
