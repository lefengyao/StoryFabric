import { describe, expect, it } from 'vitest'
import { normalizeChapterContent } from '../chapterFormatting'

describe('chapter formatting', () => {
  it('adds a full-width first-line indent to each prose paragraph', () => {
    expect(normalizeChapterContent('第一段。\n\n第二段。')).toBe('　　第一段。\n\n　　第二段。')
  })

  it('preserves Markdown structure and is idempotent', () => {
    const content = '# 小节\n\n　　正文。\n\n- 项目\n- 另一项\n\n```text\ncode\n```'
    expect(normalizeChapterContent(content)).toBe(content)
    expect(normalizeChapterContent(normalizeChapterContent(content))).toBe(content)
  })
})
