/** 极简 SSE 行解析器：从 fetch Response.body 逐行产出 */

export async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) throw new Error('响应没有内容流')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let aborted = false
  let rejectAbort!: (reason: unknown) => void
  const abortPromise = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError')
  const onAbort = () => {
    if (aborted) return
    aborted = true
    void reader.cancel().catch(() => undefined)
    rejectAbort(abortError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (aborted) onAbort()
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortPromise])
      if (aborted) throw new DOMException('The operation was aborted.', 'AbortError')
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
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

/** 提取 "data:" 行负载；非数据行返回 null；[DONE] 原样返回 */
export function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null
  return line.slice(5).trim()
}

