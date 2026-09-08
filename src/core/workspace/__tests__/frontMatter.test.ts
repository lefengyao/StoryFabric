import { describe, expect, it } from 'vitest'
import { parseFrontMatter, stringifyFrontMatter } from '../frontMatter'

describe('safe front matter', () => {
  it('parses YAML metadata and preserves Markdown content', () => {
    const parsed = parseFrontMatter('---\nid: char_1\ntitle: 测试\ntags:\n  - 术语\n---\n\n正文')

    expect(parsed.data).toEqual({ id: 'char_1', title: '测试', tags: ['术语'] })
    expect(parsed.content).toBe('\n正文')
  })

  it('serializes supported metadata without enabling executable front matter', () => {
    const raw = stringifyFrontMatter('正文', { id: 'char_1', title: '测试', tags: ['术语'] })
    const parsed = parseFrontMatter(raw)

    expect(raw).toContain('id: char_1')
    expect(parsed.data).toEqual({ id: 'char_1', title: '测试', tags: ['术语'] })
    expect(parsed.content).toBe('\n正文')
  })

  it('rejects executable YAML tags instead of evaluating them', () => {
    expect(() => parseFrontMatter('---\npayload: !!js/function >\n  function () { return 1 }\n---\n')).toThrow()
  })
})
