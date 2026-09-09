/**
 * 按 key 独立的防抖提交：同一 key 的连续调用只提交最后一次，不同 key 互不取消。
 * 单个共享定时器会让「先改 A 再改 B」取消掉 A 的待提交，这里按 key 各存一个。
 */
export function createKeyedDebounce<K extends string>(
  delayMs: number,
  run: (key: K, value: string) => void
): { schedule: (key: K, value: string) => void; cancel: (key?: K) => void } {
  const timers = new Map<K, ReturnType<typeof setTimeout>>()

  return {
    schedule: (key, value) => {
      const existing = timers.get(key)
      if (existing) clearTimeout(existing)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          run(key, value)
        }, delayMs)
      )
    },
    cancel: (key) => {
      if (key === undefined) {
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        return
      }
      const timer = timers.get(key)
      if (timer) {
        clearTimeout(timer)
        timers.delete(key)
      }
    }
  }
}
