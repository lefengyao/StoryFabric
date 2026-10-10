export const CHAPTER_PANE_COLLAPSED_KEY = 'storyfabric.ui.chapter-pane-collapsed.v1'

export function readChapterPaneCollapsed(storage: Storage | null, fallback = false): boolean {
  if (!storage) return fallback

  try {
    const value = storage.getItem(CHAPTER_PANE_COLLAPSED_KEY)
    if (value === 'true') return true
    if (value === 'false') return false
  } catch {
    return fallback
  }

  return fallback
}

export function writeChapterPaneCollapsed(storage: Storage | null, collapsed: boolean): void {
  if (!storage) return

  try {
    storage.setItem(CHAPTER_PANE_COLLAPSED_KEY, collapsed ? 'true' : 'false')
  } catch {
    // Storage can be unavailable in restricted renderer contexts.
  }
}
