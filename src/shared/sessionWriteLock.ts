const locks = new Map<string, Promise<void>>()

/**
 * Coordinates session writes made by the agent service and the renderer IPC
 * handlers. Both paths can touch the same session.json while approval is
 * waiting, so a per-session FIFO prevents a late checkpoint from restoring
 * stale title/archive metadata.
 */
export async function withSessionWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key)
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  locks.set(key, current)
  if (previous) await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}
