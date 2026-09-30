import { useEffect, useRef, type RefObject } from 'react'

/** Return keyboard focus to the workbench after an Android inspector closes. */
export function useAndroidOverlayFocus(
  open: boolean,
  fallbackSelector: string,
  backgroundRef: RefObject<HTMLElement | null>
): RefObject<HTMLElement | null> {
  const panelRef = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!window.Capacitor?.isNativePlatform?.()) return

    if (open) {
      const active = document.activeElement
      const fallback = document.querySelector<HTMLElement>(fallbackSelector)
      returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : fallback
      if (backgroundRef.current) {
        backgroundRef.current.inert = true
        backgroundRef.current.setAttribute('aria-hidden', 'true')
      }
      panelRef.current?.focus()
      return
    }

    if (backgroundRef.current) {
      backgroundRef.current.inert = false
      backgroundRef.current.removeAttribute('aria-hidden')
    }
    const previous = returnFocusRef.current
    if (!previous) return
    const fallback = document.querySelector<HTMLElement>(fallbackSelector)
    if (previous?.isConnected) previous.focus()
    else fallback?.focus()
    returnFocusRef.current = null
  }, [open, fallbackSelector, backgroundRef])

  return panelRef
}
