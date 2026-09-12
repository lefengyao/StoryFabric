import { useEffect } from 'react'
import type { MutableRefObject } from 'react'

export type ScrollPosition = { top: number; left: number }

const SCROLL_STORAGE_PREFIX = 'storyfabric.ui.scroll-position.v1'

export function scrollStorageKey(workspaceId: string, scope: string): string {
  return `${SCROLL_STORAGE_PREFIX}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(scope)}`
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
  workspaceId: string,
  scope: string,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled || !workspaceId) return

    let element: HTMLElement | null
    let key: string
    try {
      element = ref.current
      key = scrollStorageKey(workspaceId, scope)
    } catch {
      return
    }
    if (!element) return

    const storage = getLocalStorage()
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending = false
    let disposed = false

    const flush = () => {
      if (!pending) return
      pending = false
      try {
        writeScrollPosition(storage, key, { top: element.scrollTop, left: element.scrollLeft })
      } catch {
        // DOM access errors must not affect the page.
      }
    }

    const onScroll = () => {
      if (disposed) return
      pending = true
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
        requestAnimationFrame(() => {
          if (disposed) return
          try {
            const position = readScrollPosition(storage, key)
            if (position) {
              element.scrollTop = position.top
              element.scrollLeft = position.left
            }
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
      flush()
      try {
        element.removeEventListener('scroll', onScroll)
      } catch {
        // A detached or unusual element may reject event removal.
      }
    }
  }, [enabled, ref, scope, workspaceId])
}
