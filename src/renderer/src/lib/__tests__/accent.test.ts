import { describe, expect, it } from 'vitest'
import { accentStyle, accentTokens, isValidHexColor } from '../accent'

const sum = (hex: string): number => {
  const v = hex.replace('#', '')
  return parseInt(v.slice(0, 2), 16) + parseInt(v.slice(2, 4), 16) + parseInt(v.slice(4, 6), 16)
}

/** 独立的 WCAG 实现，避免与实现共享同一段数学。 */
const luminance = (hex: string): number => {
  const v = hex.replace('#', '')
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(parseInt(v.slice(0, 2), 16)) + 0.7152 * channel(parseInt(v.slice(2, 4), 16)) + 0.0722 * channel(parseInt(v.slice(4, 6), 16))
}

const contrast = (a: string, b: string): number => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe('isValidHexColor', () => {
  it('只接受 #rrggbb', () => {
    expect(isValidHexColor('#6366f1')).toBe(true)
    expect(isValidHexColor('#ABCDEF')).toBe(true)
    expect(isValidHexColor('6366f1')).toBe(false)
    expect(isValidHexColor('#6366f')).toBe(false)
    expect(isValidHexColor('#zzzzzz')).toBe(false)
    expect(isValidHexColor('')).toBe(false)
    expect(isValidHexColor(undefined as unknown as string)).toBe(false)
  })
})

describe('accentTokens', () => {
  it('保留基色并把大写归一为小写', () => {
    expect(accentTokens('#6366F1', false).accent).toBe('#6366f1')
  })

  it('给出更深的 strong，极暗基色也不会与 accent 相同', () => {
    const tokens = accentTokens('#6366f1', false)
    expect(tokens.strong).not.toBe(tokens.accent)
    expect(sum(tokens.strong)).toBeLessThan(sum(tokens.accent))
    expect(accentTokens('#000000', false).strong).not.toBe('#000000')
  })

  it('浅色主题的 soft 很浅，深色主题的 soft 很暗', () => {
    expect(sum(accentTokens('#6366f1', false).soft)).toBeGreaterThan(650)
    expect(sum(accentTokens('#6366f1', true).soft)).toBeLessThan(140)
  })

  it('前景色取白/黑中对比度更高的那个', () => {
    const bases = ['#6366f1', '#818cf8', '#f59e0b', '#10b981', '#0ea5e9', '#ef4444', '#8b5cf6', '#fde047', '#000000', '#ffffff']
    for (const base of bases) {
      const { accent, fg } = accentTokens(base, false)
      const expected = contrast(accent, '#18181b') >= contrast(accent, '#ffffff') ? '#18181b' : '#ffffff'
      expect(fg).toBe(expected)
    }
  })

  it('默认深色基色的前景色达到 WCAG AA', () => {
    const { accent, fg } = accentTokens('#818cf8', true)
    expect(fg).toBe('#18181b')
    expect(contrast(accent, fg)).toBeGreaterThanOrEqual(4.5)
  })

  it('非法基色回退到该模式的默认色', () => {
    expect(accentTokens('nope', false).accent).toBe('#6366f1')
    expect(accentTokens('', true).accent).toBe('#818cf8')
  })
})

describe('accentStyle', () => {
  it('自定义基色时返回四个变量', () => {
    const light = accentStyle({ accentColorLight: '#dc2626', accentColorDark: '#22c55e' }, false)
    expect(light['--accent']).toBe('#dc2626')
    expect(Object.keys(light).sort()).toEqual(['--accent', '--accent-fg', '--accent-soft', '--accent-strong'])
    expect(accentStyle({ accentColorLight: '#dc2626', accentColorDark: '#22c55e' }, true)['--accent']).toBe('#22c55e')
  })

  it('默认基色或非法值不写内联变量，交由 index.css 的手工配色', () => {
    expect(accentStyle({}, false)).toEqual({})
    expect(accentStyle({}, true)).toEqual({})
    expect(accentStyle({ accentColorLight: '#6366f1', accentColorDark: '#818cf8' }, false)).toEqual({})
    expect(accentStyle({ accentColorLight: 'bad', accentColorDark: 'bad' }, true)).toEqual({})
  })
})
