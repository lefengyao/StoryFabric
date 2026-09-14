import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { UiWorkspaceIdentity } from './workspaceUiScope'

export type ScrollPosition = { top: number; left: number }

const SCROLL_STORAGE_PREFIX = 'storyfabric.ui.scroll-position.v1'

export function scrollStorageKey(workspaceId: string, scope: string): string {
  return `${SCROLL_STORAGE_PREFIX}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(scope)}`
}

type ScrollWorkspace = string | UiWorkspaceIdentity

function workspaceKey(workspace: ScrollWorkspace): { current: string; legacy: string | null } {
  if (typeof workspace === 'string') return { current: workspace, legacy: null }
  const current = JSON.stringify([workspace.source, workspace.path])
  const legacy = workspace.source === 'electron-local' || workspace.source === 'android-local' ? workspace.path : null
  return { current, legacy }
}

export function readScrollPosition(storage: Storage | null, key: string): ScrollPosition | null {
  if (!storage) return null

  try {
    const raw = storage.getItem(key)
    if (raw === null) return null

    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

    const { top, left } = value as { top?: unknown; left?: unknown }
    if (
      typeof top !== 'number' ||
      typeof left !== 'number' ||
      !Number.isFinite(top) ||
      !Number.isFinite(left) ||
      top < 0 ||
      left < 0
    ) {
      return null
    }

    return { top, left }
  } catch {
    return null
  }
}

export function writeScrollPosition(storage: Storage | null, key: string, position: ScrollPosition): void {
  if (!storage) return

  try {
    storage.setItem(key, JSON.stringify({ top: position.top, left: position.left }))
  } catch {
    // Storage errors must not affect scrolling.
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

export function usePersistentScrollPosition(
  ref: MutableRefObject<HTMLElement | null>,
  workspace: ScrollWorkspace,
  scope: string,
  enabled = true
): void {
  useEffect(() => {
    const resolvedWorkspace = workspaceKey(workspace)
    if (!enabled || !resolvedWorkspace.current) return

    let element: HTMLElement | null
    let key: string
    try {
      element = ref.current
      key = scrollStorageKey(resolvedWorkspace.current, scope)
    } catch {
      return
    }
    if (!element) return

    const storage = getLocalStorage()
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: ScrollPosition | null = null
    let disposed = false
    let restoring = true
    let frame: number | null = null

    const flush = () => {
      if (!pending) return
      const position = pending
      pending = null
      try {
        writeScrollPosition(storage, key, position)
      } catch {
        // DOM access errors must not affect the page.
      }
    }

    const onScroll = () => {
      if (disposed) return
      pending = { top: element.scrollTop, left: element.scrollLeft }
      if (timer !== null) {
        try {
          clearTimeout(timer)
        } catch {
          // Timer cleanup is best effort.
        }
      }
      try {
        timer = setTimeout(() => {
          timer = null
          flush()
        }, 120)
      } catch {
        timer = null
      }
    }

    try {
      element.addEventListener('scroll', onScroll)
    } catch {
      // A detached or unusual element may reject event registration.
    }

    try {
      if (typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(() => {
          frame = null
          if (disposed) return
          try {
            const position = readScrollPosition(storage, key) ?? (resolvedWorkspace.legacy ? readScrollPosition(storage, scrollStorageKey(resolvedWorkspace.legacy, scope)) : null)
            if (position) {
              const maxTop = Number.isFinite(element.scrollHeight) && Number.isFinite(element.clientHeight) ? Math.max(0, element.scrollHeight - element.clientHeight) : position.top
              const maxLeft = Number.isFinite(element.scrollWidth) && Number.isFinite(element.clientWidth) ? Math.max(0, element.scrollWidth - element.clientWidth) : position.left
              element.scrollTop = Math.min(position.top, maxTop)
              element.scrollLeft = Math.min(position.left, maxLeft)
            } else {
              element.scrollTop = 0
              element.scrollLeft = 0
            }
            pending = null
            restoring = false
          } catch {
            // DOM/storage errors must not affect the page.
          }
        })
      }
    } catch {
      // requestAnimationFrame may be unavailable or rejected by the host.
    }

    return () => {
      disposed = true
      if (timer !== null) {
        try {
          clearTimeout(timer)
        } catch {
          // Timer cleanup is best effort.
        }
        timer = null
      }
      if (frame !== null && typeof cancelAnimationFrame === 'function') {
        try { cancelAnimationFrame(frame) } catch { /* best effort */ }
        frame = null
      }
      restoring = false
      flush()
      try {
        element.removeEventListener('scroll', onScroll)
      } catch {
        // A detached or unusual element may reject event removal.
      }
    }
  }, [enabled, ref, scope, workspace])
}
