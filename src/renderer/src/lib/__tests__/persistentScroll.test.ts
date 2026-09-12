import type { MutableRefObject } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

let runEffect: (() => void | (() => void)) | undefined

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect
  }
}))

import {
  readScrollPosition,
  scrollStorageKey,
  usePersistentScrollPosition,
  writeScrollPosition
} from '../persistentScroll'

type StorageDouble = Storage & { values: Map<string, string> }

function createStorage(): StorageDouble {
  const values = new Map<string, string>()
  return {
    values,
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  }
}

describe('persistentScroll', () => {
  it('isolates scroll keys by workspace and scope with encoded versioned segments', () => {
    const first = scrollStorageKey('workspace/one', 'outline main')
    const second = scrollStorageKey('workspace/two', 'outline main')
    const third = scrollStorageKey('workspace/one', 'chapters/main')

    expect(first).toContain('v1')
    expect(first).toContain(encodeURIComponent('workspace/one'))
    expect(first).toContain(encodeURIComponent('outline main'))
    expect(new Set([first, second, third]).size).toBe(3)
  })

  it('does not collide when encoded segments contain the old dot separator', () => {
    expect(scrollStorageKey('a.', 'b')).not.toBe(scrollStorageKey('a', '.b'))
  })

  it('reads valid non-negative finite positions from JSON', () => {
    const storage = createStorage()
    storage.values.set('scroll', JSON.stringify({ top: 12.5, left: 3 }))

    expect(readScrollPosition(storage, 'scroll')).toStrictEqual({ top: 12.5, left: 3 })
  })

  it.each([
    ['negative top', JSON.stringify({ top: -1, left: 0 })],
    ['negative left', JSON.stringify({ top: 0, left: -1 })],
    ['infinite top', '{"top":1e999,"left":0}'],
    ['non-number left', JSON.stringify({ top: 0, left: '1' })],
    ['array', JSON.stringify([0, 1])],
    ['null', JSON.stringify(null)],
    ['invalid JSON', '{']
  ])('returns null for %s', (_label, value) => {
    const storage = createStorage()
    storage.values.set('scroll', value)

    expect(readScrollPosition(storage, 'scroll')).toBeNull()
  })

  it('writes only top and left', () => {
    const storage = createStorage()

    writeScrollPosition(storage, 'scroll', { top: 8, left: 4, extra: 'ignored' } as never)

    expect(storage.values.get('scroll')).toBe(JSON.stringify({ top: 8, left: 4 }))
  })

  it('swallows storage read and write errors', () => {
    const readErrorStorage = createStorage()
    readErrorStorage.getItem = vi.fn(() => {
      throw new Error('get failed')
    })
    expect(readScrollPosition(readErrorStorage, 'scroll')).toBeNull()

    const writeErrorStorage = createStorage()
    writeErrorStorage.setItem = vi.fn(() => {
      throw new Error('set failed')
    })
    expect(() => writeScrollPosition(writeErrorStorage, 'scroll', { top: 1, left: 2 })).not.toThrow()
  })

  describe('usePersistentScrollPosition', () => {
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')

    beforeEach(() => {
      vi.useFakeTimers()
      runEffect = undefined
    })

    afterEach(() => {
      vi.useRealTimers()
      if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
      else Reflect.deleteProperty(globalThis, 'localStorage')
      if (originalRequestAnimationFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalRequestAnimationFrame)
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    })

    it('restores on animation frame and debounces scroll writes', () => {
      const storage = createStorage()
      const key = scrollStorageKey('workspace', 'outline')
      storage.values.set(key, JSON.stringify({ top: 21, left: 7 }))
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

      const frames: FrameRequestCallback[] = []
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        configurable: true,
        value: (callback: FrameRequestCallback) => {
          frames.push(callback)
          return 1
        }
      })

      const listeners = new Map<string, EventListener>()
      const element = {
        scrollTop: 0,
        scrollLeft: 0,
        addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type)
      } as unknown as HTMLElement

      usePersistentScrollPosition({ current: element } as MutableRefObject<HTMLElement | null>, 'workspace', 'outline')
      const cleanup = runEffect?.()
      expect(frames).toHaveLength(1)
      frames[0](0)
      expect({ top: element.scrollTop, left: element.scrollLeft }).toStrictEqual({ top: 21, left: 7 })

      element.scrollTop = 30
      element.scrollLeft = 11
      listeners.get('scroll')?.({} as Event)
      vi.advanceTimersByTime(119)
      expect(JSON.parse(storage.values.get(key)!)).toStrictEqual({ top: 21, left: 7 })
      vi.advanceTimersByTime(1)
      expect(JSON.parse(storage.values.get(key)!)).toStrictEqual({ top: 30, left: 11 })

      cleanup?.()
      expect(listeners.has('scroll')).toBe(false)
    })

    it('flushes a pending position during cleanup and safely ignores disabled or unmounted refs', () => {
      const storage = createStorage()
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
      Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 })
      const listeners = new Map<string, EventListener>()
      const element = {
        scrollTop: 44,
        scrollLeft: 9,
        addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type)
      } as unknown as HTMLElement

      usePersistentScrollPosition({ current: element } as MutableRefObject<HTMLElement | null>, 'workspace', 'outline')
      const cleanup = runEffect?.()
      listeners.get('scroll')?.({} as Event)
      cleanup?.()

      expect(readScrollPosition(storage, scrollStorageKey('workspace', 'outline'))).toStrictEqual({ top: 44, left: 9 })
      expect(() => {
        usePersistentScrollPosition({ current: null } as MutableRefObject<HTMLElement | null>, '', 'outline', false)
        runEffect?.()
      }).not.toThrow()
    })

    it('safely returns when enabled but the ref is not mounted', () => {
      usePersistentScrollPosition({ current: null } as MutableRefObject<HTMLElement | null>, 'workspace', 'outline', true)

      expect(() => runEffect?.()).not.toThrow()
    })
  })
})
