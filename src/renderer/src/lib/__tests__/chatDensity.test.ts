import { describe, expect, it } from 'vitest'
import { chatDensityClasses } from '../chatDensity'

describe('chatDensityClasses', () => {
  it('舒适档与改动前的观感一致', () => {
    const cls = chatDensityClasses('comfortable')
    expect(cls.list).toBe('space-y-4')
    expect(cls.userBubble).toContain('px-4')
    expect(cls.userBubble).toContain('py-2.5')
    expect(cls.userBubble).toContain('leading-relaxed')
    expect(cls.assistantBubble).toBe('px-4 py-3')
  })

  it('三档互不相同且紧凑更小、宽松更大', () => {
    const compact = chatDensityClasses('compact')
    const spacious = chatDensityClasses('spacious')
    expect(compact.userBubble).not.toBe(spacious.userBubble)
    expect(compact.list).toBe('space-y-2')
    expect(spacious.list).toBe('space-y-6')
  })

  it('未知取值回落到舒适档', () => {
    expect(chatDensityClasses('nope' as never)).toEqual(chatDensityClasses('comfortable'))
  })
})
