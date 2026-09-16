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
