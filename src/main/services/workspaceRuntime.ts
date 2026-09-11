import { NodeFileStore } from '../../core/storage/nodeFileStore'

interface WorkspaceRuntime {
  store: NodeFileStore
  queue: Promise<unknown>
}

const runtimes = new Map<string, WorkspaceRuntime>()

export function workspaceStore(root: string): NodeFileStore {
  const existing = runtimes.get(root)
  if (existing) return existing.store
  const runtime: WorkspaceRuntime = { store: new NodeFileStore(root), queue: Promise.resolve() }
  runtimes.set(root, runtime)
  return runtime.store
}

export function serializeWorkspace<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const runtime = runtimes.get(root) ?? { store: workspaceStore(root), queue: Promise.resolve() }
  const run = runtime.queue.then(operation, operation)
  runtime.queue = run.catch(() => undefined)
  runtimes.set(root, runtime)
  return run
}
