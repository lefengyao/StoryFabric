import { describe, expect, it } from 'vitest'
import { chatTypographyStyle } from '../chatTypography'

describe('chatTypographyStyle', () => {
  it('缺省时保持当前 14px 会话观感', () => {
    expect(chatTypographyStyle({})['--chat-font-size']).toBe('14px')
  })

  it('把字号设置映射为会话变量', () => {
    const style = chatTypographyStyle({ chatFontSize: 18 })
    expect(style['--chat-font-size']).toBe('18px')
    expect(style['--chat-font-meta-size']).toBe('16px')
    expect(style['--chat-font-micro-size']).toBe('14px')
  })

  it('对非法和越界值执行同一范围约束', () => {
    expect(chatTypographyStyle({ chatFontSize: 1 })['--chat-font-size']).toBe('13px')
    expect(chatTypographyStyle({ chatFontSize: 99 })['--chat-font-size']).toBe('20px')
    expect(chatTypographyStyle({ chatFontSize: Number.NaN })['--chat-font-size']).toBe('14px')
  })
})
