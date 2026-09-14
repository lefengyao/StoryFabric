import { describe, expect, it } from 'vitest'
import { resolveChapterTarget, type ChapterReadingState } from '../chapterReadingState'

const chapters = {
  main: [{ id: 'A', order: 1 }, { id: 'B', order: 2 }],
  draft: [{ id: 'C', order: 1 }]
}

describe('chapter reading state', () => {
  it.each([
    [{ activeBox: 'main', lastChapterByBox: { main: 'A' } }, { box: 'main', chapterId: 'A' }],
    [{ activeBox: 'draft', lastChapterByBox: { draft: 'C' } }, { box: 'draft', chapterId: 'C' }],
    [{ activeBox: 'trash', lastChapterByBox: {} }, { box: 'trash', chapterId: null }],
    [{ activeBox: 'main', lastChapterByBox: { main: 'missing' } }, { box: 'main', chapterId: 'A' }]
  ])('resolves a remembered chapter or a valid fallback', (state, expected) => {
    const actual = resolveChapterTarget(state as ChapterReadingState, chapters)
    expect(actual).toEqual(expected)
  })

  it('follows a remembered chapter that moved to another box and corrects the box', () => {
    expect(resolveChapterTarget({ activeBox: 'main', lastChapterByBox: { main: 'C' } }, chapters))
      .toEqual({ box: 'draft', chapterId: 'C' })
  })

  it('returns an empty state for an empty target box', () => {
    expect(resolveChapterTarget({ activeBox: 'main', lastChapterByBox: { main: 'A' } }, { main: [], draft: [] }))
      .toEqual({ box: 'main', chapterId: null })
  })
})
