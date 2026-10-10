import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { useSyncExternalStore } from 'react'

interface KeyboardState { visible: boolean; viewportHeight: number }
interface KeyboardPlugin {
  getState(): Promise<KeyboardState>
  addListener(event: 'visibilityChange', listener: (state: KeyboardState) => void): Promise<PluginListenerHandle>
}

const keyboard = registerPlugin<KeyboardPlugin>('StoryFabricKeyboard')
let visible = false
const listeners = new Set<() => void>()

/** Native measurements work both when the WebView resizes and when Android draws behind the IME. */
export function initializeAndroidKeyboard(): () => void {
  let disposed = false
  let revision = 0
  let handle: PluginListenerHandle | null = null
  let nativeState: KeyboardState = { visible: false, viewportHeight: 0 }
  const browser = typeof window === 'undefined' ? null : window
  const viewport = browser?.visualViewport
  let viewportWidth = browser?.innerWidth ?? 0
  let fullHeight = browser?.innerHeight ?? 0
  const apply = (state: KeyboardState): void => {
    if (disposed) return
    const changed = visible !== state.visible
    visible = state.visible === true
    document.documentElement.classList.toggle('android-keyboard-open', visible)
    if (visible && Number.isFinite(state.viewportHeight) && state.viewportHeight > 0) {
      document.documentElement.style.setProperty('--android-visible-height', state.viewportHeight + 'px')
    } else document.documentElement.style.removeProperty('--android-visible-height')
    if (changed) listeners.forEach((listener) => listener())
  }
  // Some older shells/IMEs omit native visibility events. A focused text field
  // plus a substantially shorter visual viewport provides a conservative fallback.
  const measureViewport = (): void => {
    if (disposed) return
    const height = Math.min(browser?.innerHeight ?? 0, viewport?.height ?? Infinity)
    const width = browser?.innerWidth ?? 0
    if (Math.abs(width - viewportWidth) > 1) {
      viewportWidth = width
      fullHeight = height
    } else fullHeight = Math.max(fullHeight, height)
    const focused = document.activeElement?.closest?.('textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), [contenteditable="true"]')
    const fallbackVisible = Boolean(focused && (!viewport || viewport.scale === undefined || viewport.scale === 1) && fullHeight - height > 120)
    apply(nativeState.visible ? nativeState : { visible: fallbackVisible, viewportHeight: height })
  }
  const applyNative = (state: KeyboardState): void => {
    if (disposed) return
    revision++
    nativeState = state
    measureViewport()
  }
  const queryNative = (): void => {
    if (disposed) return
    const initialRevision = revision
    void keyboard.getState().then((state) => { if (initialRevision === revision) applyNative(state) }).catch(() => {})
  }
  viewport?.addEventListener('resize', measureViewport)
  browser?.addEventListener('resize', measureViewport)
  document.addEventListener?.('focusin', measureViewport)
  document.addEventListener?.('focusout', measureViewport)
  void keyboard.addListener('visibilityChange', applyNative).then((listener) => {
    if (disposed) { void listener.remove(); return }
    handle = listener
    queryNative()
  }).catch(queryNative)
  return () => {
    disposed = true
    void handle?.remove()
    viewport?.removeEventListener('resize', measureViewport)
    browser?.removeEventListener('resize', measureViewport)
    document.removeEventListener?.('focusin', measureViewport)
    document.removeEventListener?.('focusout', measureViewport)
    visible = false
    document.documentElement.classList.remove('android-keyboard-open')
    document.documentElement.style.removeProperty('--android-visible-height')
    listeners.forEach((listener) => listener())
  }
}

export function useAndroidKeyboardVisible(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => visible, () => false)
}
