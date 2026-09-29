import { describe, expect, it } from 'vitest'
import { boxForChapterStatus, resolveChapterPlacement, statusForChapterBox } from '../chapterPlacement'

describe('chapter placement', () => {
  it('maps draft and revised to the draft box, body and final to the main box', () => {
    expect(boxForChapterStatus('draft')).toBe('draft')
    expect(boxForChapterStatus('revised')).toBe('draft')
    expect(boxForChapterStatus('body')).toBe('main')
    expect(boxForChapterStatus('final')).toBe('main')
    expect(statusForChapterBox('main')).toBe('body')
  })

  it('rejects an explicit status and box contradiction', () => {
    expect(() => resolveChapterPlacement(null, { box: 'main', status: 'draft' })).toThrow('状态与箱位不一致')
    expect(() => resolveChapterPlacement(null, { box: 'draft', status: 'body' })).toThrow('状态与箱位不一致')
  })

  it('adjusts status when only the box changes', () => {
    expect(resolveChapterPlacement({ box: 'main', status: 'final' }, { box: 'draft' })).toEqual({ box: 'draft', status: 'draft' })
    expect(resolveChapterPlacement({ box: 'draft', status: 'revised' }, { box: 'main' })).toEqual({ box: 'main', status: 'body' })
  })
})
