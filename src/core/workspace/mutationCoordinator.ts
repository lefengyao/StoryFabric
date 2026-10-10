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
const sharedCoordinators = new Map<string, MutationCoordinator>()

export function normalizedStorageIdentity(store: FileStore): string | undefined {
  const identity = store.storageIdentity?.()
  if (!identity) return undefined
  const normalized = identity.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

export function coordinatorFor(store: FileStore): MutationCoordinator {
  const identity = normalizedStorageIdentity(store)
  if (identity) {
    let shared = sharedCoordinators.get(identity)
    if (!shared) { shared = new MutationCoordinator(); sharedCoordinators.set(identity, shared) }
    return shared
  }
  const existing = coordinators.get(store)
  if (existing) return existing
  const created = new MutationCoordinator()
  coordinators.set(store, created)
  return created
}
