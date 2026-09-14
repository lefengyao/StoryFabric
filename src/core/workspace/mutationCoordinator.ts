import type { FileStore } from '../storage/fileStore'

/** Serializes short read-validate-commit sections, never model or user wait time. */
export class MutationCoordinator {
  private readonly queues = new Map<string, Promise<unknown>>()

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    this.queues.set(key, run)
    return run.finally(() => {
      if (this.queues.get(key) === run) this.queues.delete(key)
    })
  }
}

const coordinators = new WeakMap<FileStore, MutationCoordinator>()

export function coordinatorFor(store: FileStore): MutationCoordinator {
  const existing = coordinators.get(store)
  if (existing) return existing
  const created = new MutationCoordinator()
  coordinators.set(store, created)
  return created
}
