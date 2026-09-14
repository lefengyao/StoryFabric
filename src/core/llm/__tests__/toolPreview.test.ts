import { expect, it } from 'vitest'
import { ToolBodyPreview } from '../toolPreview'

it('reveals an allowed nested body before the tool JSON is complete without executing it', () => {
  const preview = new ToolBodyPreview({ toolName: 'save_chapter', contentPath: ['chapter', 'content'] })
  expect(preview.push('{"chapter":{"title":"测试章","box":"draft","content":"风停')).toBe('风停')
  expect(preview.isComplete()).toBe(false)
  expect(preview.push('了。"}}')).toBe('风停了。')
  expect(preview.isComplete()).toBe(true)
  expect(preview.getArguments()).toEqual({ chapter: { title: '测试章', box: 'draft', content: '风停了。' } })
})

it('does not expose a body from a different path or treat malformed JSON as complete', () => {
  const preview = new ToolBodyPreview({ toolName: 'save_chapter', contentPath: ['chapter', 'content'] })
  expect(preview.push('{"chapter":{"notes":"不要展示","content":"可见\\n')).toBe('可见')
  expect(preview.isComplete()).toBe(false)
  expect(preview.push('正文"}')).toBe('可见\n正文')
  expect(preview.isComplete()).toBe(false)
  expect(preview.getArguments()).toBeNull()
})
