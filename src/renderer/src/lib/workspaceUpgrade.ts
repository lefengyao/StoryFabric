import type { WorkspaceRequestOptions } from '../../../shared/api'

export type WorkspaceUpgradeResult<T> = { status: 'opened'; value: T } | { status: 'cancelled' }

export interface WorkspaceUpgradeOptions {
  options?: WorkspaceRequestOptions
  isCurrent?: () => boolean
  confirmUpgrade: (path: string, signal?: AbortSignal) => Promise<boolean>
  createRetryOptions?: () => WorkspaceRequestOptions
}

export function isWorkspaceUpgradeRequired(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'WORKSPACE_UPGRADE_REQUIRED') return true
  const message = error instanceof Error ? error.message : String(error)
  return /(?:^|[\s:：])WORKSPACE_UPGRADE_REQUIRED(?=[:：\s]|$)/.test(message)
}

let retrySequence = 0

/** Each IPC attempt needs its own cancellation ID; approval is scoped to this attempt. */
export function createWorkspaceUpgradeRetryOptions(options?: WorkspaceRequestOptions): WorkspaceRequestOptions {
  return {
    ...options,
    requestId: `workspace-upgrade-${Date.now().toString(36)}-${++retrySequence}`
  }
}

async function awaitUpgradeConfirmation(
  path: string,
  confirm: WorkspaceUpgradeOptions['confirmUpgrade'],
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) return false
  if (!signal) return confirm(path)
  return new Promise<boolean>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); resolve(false) }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => signal.aborted ? false : confirm(path, signal)).then(
      (approved) => { signal.removeEventListener('abort', abort); resolve(approved) },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error) }
    )
  })
}

/** Opens the captured selection, then retries exactly once only after explicit approval. */
export async function openWorkspaceWithUpgrade<T>(
  path: string,
  open: (path: string, options?: WorkspaceRequestOptions) => Promise<T>,
  settings: WorkspaceUpgradeOptions
): Promise<WorkspaceUpgradeResult<T>> {
  const isCurrent = (): boolean => !settings.options?.signal?.aborted && settings.isCurrent?.() !== false
  if (!isCurrent()) return { status: 'cancelled' }
  try {
    const value = await open(path, settings.options)
    return isCurrent() ? { status: 'opened', value } : { status: 'cancelled' }
  } catch (error) {
    if (!isCurrent()) return { status: 'cancelled' }
    if (!isWorkspaceUpgradeRequired(error) || settings.options?.upgradeLegacy) throw error
    const approved = await awaitUpgradeConfirmation(path, settings.confirmUpgrade, settings.options?.signal)
    if (!approved || !isCurrent()) return { status: 'cancelled' }
    const retryOptions = settings.createRetryOptions?.() ?? createWorkspaceUpgradeRetryOptions(settings.options)
    const options = { ...settings.options, ...retryOptions, upgradeLegacy: true }
    if (options.signal?.aborted || !isCurrent()) return { status: 'cancelled' }
    const value = await open(path, options)
    return isCurrent() ? { status: 'opened', value } : { status: 'cancelled' }
  }
}
