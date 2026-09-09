/**
 * 空闲自动保存：每次 schedule 重置计时，到点后只执行一次。
 * delayMs <= 0 视为关闭，schedule 不产生任何效果。
 */
export interface Autosave {
  /** 重新开始计时；到点执行传入的回调。 */
  schedule: (run: () => void) => void
  cancel: () => void
}

export function createAutosave(delayMs: number): Autosave {
  let handle: ReturnType<typeof setTimeout> | null = null

  return {
    schedule: (run) => {
      if (!Number.isFinite(delayMs) || delayMs <= 0) return
      if (handle) clearTimeout(handle)
      handle = setTimeout(() => {
        handle = null
        run()
      }, delayMs)
    },
    cancel: () => {
      if (handle) {
        clearTimeout(handle)
        handle = null
      }
    }
  }
}
