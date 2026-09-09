/**
 * 空闲自动保存：每次 schedule 重置计时，到点后只执行一次。
 * delayMs <= 0 视为关闭，schedule 不产生任何效果。
 */
export interface Autosave {
  /** 重新开始计时；到点执行传入的回调。 */
  schedule: (run: () => void) => void
  cancel: () => void
  /** 立即执行待处理的保存（例如离开页面时）；没有待处理则什么都不做。 */
  flush: () => void
}

export function createAutosave(delayMs: number): Autosave {
  let handle: ReturnType<typeof setTimeout> | null = null
  let pendingRun: (() => void) | null = null

  const clear = (): void => {
    if (handle) {
      clearTimeout(handle)
      handle = null
    }
  }

  return {
    schedule: (run) => {
      if (!Number.isFinite(delayMs) || delayMs <= 0) return
      pendingRun = run
      clear()
      handle = setTimeout(() => {
        handle = null
        const pending = pendingRun
        pendingRun = null
        pending?.()
      }, delayMs)
    },
    cancel: () => {
      clear()
      pendingRun = null
    },
    flush: () => {
      clear()
      const pending = pendingRun
      pendingRun = null
      pending?.()
    }
  }
}
