import { expect, it } from 'vitest'
import { isConversationAtBottom } from '../useChatScroll'

it('follows output only when the user is near the bottom', () => {
  expect(isConversationAtBottom({ scrollTop: 300, clientHeight: 400, scrollHeight: 1000 })).toBe(false)
  expect(isConversationAtBottom({ scrollTop: 580, clientHeight: 400, scrollHeight: 1000 })).toBe(true)
})
