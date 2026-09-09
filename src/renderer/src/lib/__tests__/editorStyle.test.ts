import { describe, expect, it } from 'vitest'
import { editorStyle } from '../editorStyle'

describe('editorStyle', () => {
  it('缺省时回落到当前观感（14px / 1.75 / 系统字体）', () => {
    const style = editorStyle({})
    expect(style['--editor-font-size']).toBe('14px')
    expect(style['--editor-line-height']).toBe('1.75')
    expect(style['--editor-font']).toContain('system-ui')
  })

  it('按设置输出 CSS 变量', () => {
    const style = editorStyle({ editorFontSize: 18, editorLineHeight: 2.2, editorFontFamily: 'serif' })
    expect(style['--editor-font-size']).toBe('18px')
    expect(style['--editor-line-height']).toBe('2.2')
    expect(style['--editor-font']).toContain('Georgia')
  })

  it('等宽字体走 mono 栈', () => {
    expect(editorStyle({ editorFontFamily: 'mono' })['--editor-font']).toContain('monospace')
  })

  it('非法值被夹紧或回落', () => {
    expect(editorStyle({ editorFontSize: 99 })['--editor-font-size']).toBe('24px')
    expect(editorStyle({ editorFontSize: 1 })['--editor-font-size']).toBe('12px')
    expect(editorStyle({ editorLineHeight: 9 })['--editor-line-height']).toBe('3')
    expect(editorStyle({ editorFontFamily: 'nope' as never })['--editor-font']).toContain('system-ui')
  })
})
