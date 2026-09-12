import { describe, expect, it, vi } from 'vitest'
import { readSidebarExpanded, SIDEBAR_EXPANDED_KEY, writeSidebarExpanded } from '../navigationPreference'

type StorageDouble = Storage & {
  values: Map<string, string>
  throwOnGet?: boolean
  throwOnSet?: boolean
}

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

describe('navigationPreference', () => {
  it('defaults to expanded when the preference is absent', () => {
    expect(readSidebarExpanded(createStorage())).toBe(true)
    expect(readSidebarExpanded(createStorage(), false)).toBe(false)
    expect(readSidebarExpanded(null)).toBe(true)
  })

  it('persists true and false as literal string values', () => {
    const storage = createStorage()

    writeSidebarExpanded(storage, false)
    expect(storage.values.get(SIDEBAR_EXPANDED_KEY)).toBe('false')
    expect(readSidebarExpanded(storage)).toBe(false)

    writeSidebarExpanded(storage, true)
    expect(storage.values.get(SIDEBAR_EXPANDED_KEY)).toBe('true')
    expect(readSidebarExpanded(storage)).toBe(true)
  })

  it('uses the fallback for values other than true or false', () => {
    const storage = createStorage()
    storage.values.set(SIDEBAR_EXPANDED_KEY, '1')

    expect(readSidebarExpanded(storage)).toBe(true)
    expect(readSidebarExpanded(storage, false)).toBe(false)
  })

  it('swallows storage read and write errors', () => {
    const getErrorStorage = createStorage()
    getErrorStorage.getItem = vi.fn(() => {
      throw new Error('get failed')
    })
    expect(readSidebarExpanded(getErrorStorage, false)).toBe(false)

    const setErrorStorage = createStorage()
    setErrorStorage.setItem = vi.fn(() => {
      throw new Error('set failed')
    })
    expect(() => writeSidebarExpanded(setErrorStorage, true)).not.toThrow()
  })
})
