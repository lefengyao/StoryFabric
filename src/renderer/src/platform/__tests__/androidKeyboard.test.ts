import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const doubles = vi.hoisted(() => ({ addListener: vi.fn(), getState: vi.fn(), remove: vi.fn() }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => doubles }))
import { initializeAndroidKeyboard } from '../androidKeyboard'

let callback: (state: { visible: boolean; viewportHeight: number }) => void
let classes: Set<string>
let properties: Map<string, string>
beforeEach(() => {
  classes = new Set(); properties = new Map()
  vi.stubGlobal('document', { documentElement: {
    classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name), remove: (name: string) => classes.delete(name) },
    style: { setProperty: (name: string, value: string) => properties.set(name, value), removeProperty: (name: string) => properties.delete(name) }
  } })
  doubles.addListener.mockImplementation(async (_event, listener) => { callback = listener; return { remove: doubles.remove } })
  doubles.getState.mockResolvedValue({ visible: false, viewportHeight: 844 })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

it('uses the native visible viewport and clears it when the keyboard closes', async () => {
  const dispose = initializeAndroidKeyboard()
  await tick()
  callback({ visible: true, viewportHeight: 480 })
  expect(classes.has('android-keyboard-open')).toBe(true)
  expect(properties.get('--android-visible-height')).toBe('480px')
  callback({ visible: true, viewportHeight: 215 })
  expect(properties.get('--android-visible-height')).toBe('215px')
  callback({ visible: false, viewportHeight: 844 })
  expect(classes.has('android-keyboard-open')).toBe(false)
  expect(properties.has('--android-visible-height')).toBe(false)
  dispose()
  expect(doubles.remove).toHaveBeenCalledOnce()
})
it('does not let a delayed initial query overwrite a newer keyboard event', async () => {
  let resolve!: (state: { visible: boolean; viewportHeight: number }) => void
  doubles.getState.mockReturnValue(new Promise((done) => { resolve = done }))
  const dispose = initializeAndroidKeyboard()
  await tick()
  callback({ visible: true, viewportHeight: 420 })
  resolve({ visible: false, viewportHeight: 844 })
  await tick()
  expect(properties.get('--android-visible-height')).toBe('420px')
  dispose()
})
it('removes a listener that arrives after unmount and ignores late events', async () => {
  let resolve!: (value: { remove: () => void }) => void
  doubles.addListener.mockReturnValue(new Promise((done) => { resolve = done }))
  const dispose = initializeAndroidKeyboard()
  dispose()
  resolve({ remove: doubles.remove })
  await tick()
  expect(doubles.remove).toHaveBeenCalledOnce()
  expect(doubles.getState).not.toHaveBeenCalled()
})

it('still queries the native state when an older shell cannot subscribe to keyboard events', async () => {
  doubles.addListener.mockRejectedValueOnce(new Error('Listener unavailable'))
  doubles.getState.mockResolvedValueOnce({ visible: true, viewportHeight: 420 })
  const dispose = initializeAndroidKeyboard()
  await tick()
  expect(doubles.getState).toHaveBeenCalledOnce()
  expect(properties.get('--android-visible-height')).toBe('420px')
  dispose()
})

function installViewport(): { viewport: EventTarget & { height: number; width: number }; browser: EventTarget & { innerHeight: number; innerWidth: number; visualViewport: EventTarget & { height: number; width: number } }; doc: EventTarget & { activeElement: unknown } } {
  const viewport = Object.assign(new EventTarget(), { height: 844, width: 390 })
  const browser = Object.assign(new EventTarget(), { innerHeight: 844, innerWidth: 390, visualViewport: viewport })
  const doc = Object.assign(new EventTarget(), { documentElement: document.documentElement, activeElement: null as unknown })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', doc)
  return { viewport, browser, doc }
}

it('uses the resized WebView for a focused editor when the keyboard plugin is unavailable', async () => {
  const { viewport, browser, doc } = installViewport()
  doubles.addListener.mockRejectedValueOnce(new Error('Plugin unavailable'))
  doubles.getState.mockRejectedValueOnce(new Error('Plugin unavailable'))
  const dispose = initializeAndroidKeyboard()
  await tick()
  doc.activeElement = { closest: (selector: string) => selector.includes('contenteditable') ? {} : null }
  viewport.height = browser.innerHeight = 420
  viewport.dispatchEvent(new Event('resize'))
  expect(classes.has('android-keyboard-open')).toBe(true)
  expect(properties.get('--android-visible-height')).toBe('420px')
  viewport.height = browser.innerHeight = 844
  viewport.dispatchEvent(new Event('resize'))
  expect(classes.has('android-keyboard-open')).toBe(false)
  expect(properties.has('--android-visible-height')).toBe(false)
  dispose()
  viewport.height = browser.innerHeight = 420
  viewport.dispatchEvent(new Event('resize'))
  expect(classes.has('android-keyboard-open')).toBe(false)
})

it('does not confuse a rotation or a resized non-editable page with an open keyboard', async () => {
  const { viewport, browser, doc } = installViewport()
  const dispose = initializeAndroidKeyboard()
  await tick()
  viewport.height = browser.innerHeight = 420
  viewport.dispatchEvent(new Event('resize'))
  expect(classes.has('android-keyboard-open')).toBe(false)
  doc.activeElement = { closest: () => ({}) }
  viewport.width = browser.innerWidth = 844
  viewport.height = browser.innerHeight = 390
  viewport.dispatchEvent(new Event('resize'))
  expect(classes.has('android-keyboard-open')).toBe(false)
  dispose()
})

it('keeps native measurements authoritative while the WebView has not resized', async () => {
  const { viewport } = installViewport()
  const dispose = initializeAndroidKeyboard()
  await tick()
  callback({ visible: true, viewportHeight: 215 })
  viewport.dispatchEvent(new Event('resize'))
  expect(properties.get('--android-visible-height')).toBe('215px')
  dispose()
})

it('does not mistake pinch zoom for keyboard opening and clears fallback state on blur', async () => {
  const { viewport, browser, doc } = installViewport()
  const dispose = initializeAndroidKeyboard()
  await tick()
  doc.activeElement = { closest: () => ({}) }
  const scaledViewport = viewport as typeof viewport & { scale: number }
  scaledViewport.scale = 2
  viewport.height = 420
  viewport.dispatchEvent(new Event('resize'))
  expect(classes.has('android-keyboard-open')).toBe(false)
  scaledViewport.scale = 1
  browser.innerHeight = 420
  viewport.dispatchEvent(new Event('resize'))
  expect(classes.has('android-keyboard-open')).toBe(true)
  doc.activeElement = null
  doc.dispatchEvent(new Event('focusout'))
  expect(classes.has('android-keyboard-open')).toBe(false)
  dispose()
})
