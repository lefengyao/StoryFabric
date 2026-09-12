export const SIDEBAR_EXPANDED_KEY = 'storyfabric.ui.sidebar-expanded.v1'

export function readSidebarExpanded(storage: Storage | null, fallback = true): boolean {
  if (!storage) return fallback

  try {
    const value = storage.getItem(SIDEBAR_EXPANDED_KEY)
    if (value === 'true') return true
    if (value === 'false') return false
  } catch {
    return fallback
  }

  return fallback
}

export function writeSidebarExpanded(storage: Storage | null, expanded: boolean): void {
  if (!storage) return

  try {
    storage.setItem(SIDEBAR_EXPANDED_KEY, expanded ? 'true' : 'false')
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }
}
