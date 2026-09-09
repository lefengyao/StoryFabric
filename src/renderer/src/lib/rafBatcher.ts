/**
 * 把高频回调合并到每帧一次，避免流式 token 每次都触发一次 React 更新。
 * requestAnimationFrame 不可用（后台标签页/测试环境）时退回 setTimeout。
 */
export interface RafBatcher<T> {
  push: (value: T) => void
  /** 立即冲刷待处理值（例如流结束前），并取消已排期的回调。 */
  flush: () => void
}

function defaultSchedule(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
  return setTimeout(cb, 16) as unknown as number
}

function defaultCancel(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
}

export function createRafBatcher<T>(
  onFlush: (pending: T[]) => void,
  options: { schedule?: (cb: () => void) => number; cancel?: (handle: number) => void } = {}
): RafBatcher<T> {
  const schedule = options.schedule ?? defaultSchedule
  const cancel = options.cancel ?? defaultCancel
  let pending: T[] = []
  let handle: number | null = null

  const run = (): void => {
    handle = null
    if (!pending.length) return
    const batch = pending
    pending = []
    onFlush(batch)
  }

  return {
    push: (value) => {
      pending.push(value)
      if (handle === null) handle = schedule(run)
    },
    flush: () => {
      if (handle !== null) {
        cancel(handle)
        handle = null
      }
      run()
    }
  }
}
