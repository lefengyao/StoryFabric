import { describe, expect, it } from 'vitest'
import { chatInputHeight } from '../chatInputSizing'

describe('compact chat input height', () => {
  it('keeps short drafts at one line and shrinks again after deleting a long draft', () => {
    expect(chatInputHeight(24, 30, 600)).toBe(30)
    expect(chatInputHeight(80, 30, 600)).toBe(80)
    expect(chatInputHeight(24, 30, 600)).toBe(30)
  })

  it('reserves conversation space when landscape or the keyboard reduces the column height', () => {
    expect(chatInputHeight(500, 30, 250)).toBe(45)
    expect(chatInputHeight(500, 30, 160)).toBe(30)
  })

  it('caps long portrait drafts while keeping a usable line in very short columns', () => {
    expect(chatInputHeight(500, 30, 800)).toBe(96)
    expect(chatInputHeight(500, 30, 60)).toBe(30)
  })
})
