import { expect, it } from 'vitest'
import { ToolBodyPreview } from '../toolPreview'

it('shows incrementally readable chapter content before the tool JSON is complete', () => {
  const preview = new ToolBodyPreview({ toolName: 'save_chapter', contentPath: ['chapter', 'content'] })

  expect(preview.push('{"chapter":{"title":"测试章","box":"draft","content":"风停')).toBe('风停')
  expect(preview.isComplete()).toBe(false)
  expect(preview.push('了。"}}')).toBe('风停了。')
  expect(preview.isComplete()).toBe(true)
})

it('does not expose an unrelated field as a chapter body', () => {
  const preview = new ToolBodyPreview({ toolName: 'save_chapter', contentPath: ['chapter', 'content'] })
  expect(preview.push('{"chapter":{"title":"测试章","summary":"不要显示"')).toBe('')
  expect(preview.isComplete()).toBe(false)
})

it('throttles large partial previews so long chapter arguments do not rescan every chunk', () => {
  const preview = new ToolBodyPreview({ toolName: 'save_chapter', contentPath: ['chapter', 'content'] })
  const prefix = '{"chapter":{"content":"'

  expect(preview.push(`${prefix}${'a'.repeat(4096)}`)).toHaveLength(4096)
  expect(preview.push('b'.repeat(100))).toBeNull()
})

it('previews only the new prose when appending to a chapter', () => {
  const preview = new ToolBodyPreview({ toolName: 'append_chapter', contentPath: ['appendText'] })
  expect(preview.push('{"chapterId":"chapter-1","appendText":"新')).toBe('新')
  expect(preview.push('增正文"}')).toBe('新增正文')
})
