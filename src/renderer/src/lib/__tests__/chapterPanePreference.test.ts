import { describe, expect, it, vi } from 'vitest'
import { CHAPTER_PANE_COLLAPSED_KEY, readChapterPaneCollapsed, writeChapterPaneCollapsed } from '../chapterPanePreference'

type StorageDouble = Storage & {
  values: Map<string, string>
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

describe('chapterPanePreference', () => {
  it('defaults to expanded when the preference is absent', () => {
    expect(readChapterPaneCollapsed(createStorage())).toBe(false)
    expect(readChapterPaneCollapsed(createStorage(), true)).toBe(true)
    expect(readChapterPaneCollapsed(null)).toBe(false)
  })

  it('persists true and false as literal string values', () => {
    const storage = createStorage()

    writeChapterPaneCollapsed(storage, true)
    expect(storage.values.get(CHAPTER_PANE_COLLAPSED_KEY)).toBe('true')
    expect(readChapterPaneCollapsed(storage)).toBe(true)

    writeChapterPaneCollapsed(storage, false)
    expect(storage.values.get(CHAPTER_PANE_COLLAPSED_KEY)).toBe('false')
    expect(readChapterPaneCollapsed(storage)).toBe(false)
  })

  it('uses the fallback for values other than true or false', () => {
    const storage = createStorage()
    storage.values.set(CHAPTER_PANE_COLLAPSED_KEY, '1')

    expect(readChapterPaneCollapsed(storage)).toBe(false)
    expect(readChapterPaneCollapsed(storage, true)).toBe(true)
  })

  it('swallows storage read and write errors', () => {
    const getErrorStorage = createStorage()
    getErrorStorage.getItem = vi.fn(() => {
      throw new Error('get failed')
    })
    expect(readChapterPaneCollapsed(getErrorStorage, true)).toBe(true)

    const setErrorStorage = createStorage()
    setErrorStorage.setItem = vi.fn(() => {
      throw new Error('set failed')
    })
    expect(() => writeChapterPaneCollapsed(setErrorStorage, true)).not.toThrow()
  })
})
