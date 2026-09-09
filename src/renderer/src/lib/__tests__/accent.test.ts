import { describe, expect, it } from 'vitest'
import { accentStyle, accentTokens, isValidHexColor } from '../accent'

const sum = (hex: string): number => {
  const v = hex.replace('#', '')
  return parseInt(v.slice(0, 2), 16) + parseInt(v.slice(2, 4), 16) + parseInt(v.slice(4, 6), 16)
}

describe('isValidHexColor', () => {
  it('只接受 #rrggbb', () => {
    expect(isValidHexColor('#6366f1')).toBe(true)
    expect(isValidHexColor('#ABCDEF')).toBe(true)
    expect(isValidHexColor('6366f1')).toBe(false)
    expect(isValidHexColor('#6366f')).toBe(false)
    expect(isValidHexColor('#zzzzzz')).toBe(false)
    expect(isValidHexColor('')).toBe(false)
  })
})

describe('accentTokens', () => {
  it('保留基色并给出更深的 strong', () => {
    const tokens = accentTokens('#6366f1', false)
    expect(tokens.accent).toBe('#6366f1')
    expect(tokens.strong).not.toBe(tokens.accent)
    expect(sum(tokens.strong)).toBeLessThan(sum(tokens.accent))
  })

  it('浅色主题的 soft 很浅，深色主题的 soft 很暗', () => {
    expect(sum(accentTokens('#6366f1', false).soft)).toBeGreaterThan(650)
    expect(sum(accentTokens('#6366f1', true).soft)).toBeLessThan(120)
  })

  it('按基色亮度选择前景色', () => {
    expect(accentTokens('#6366f1', false).fg).toBe('#ffffff')
    expect(accentTokens('#fde047', false).fg).toBe('#18181b')
  })

  it('非法基色回退到该模式的默认色', () => {
    expect(accentTokens('nope', false).accent).toBe('#6366f1')
    expect(accentTokens('nope', true).accent).toBe('#818cf8')
  })
})

describe('accentStyle', () => {
  it('按主题选择对应基色并返回四个变量', () => {
    const light = accentStyle({ accentColorLight: '#dc2626', accentColorDark: '#22c55e' }, false)
    expect(light['--accent']).toBe('#dc2626')
    expect(Object.keys(light).sort()).toEqual(['--accent', '--accent-fg', '--accent-soft', '--accent-strong'])
    expect(accentStyle({ accentColorLight: '#dc2626', accentColorDark: '#22c55e' }, true)['--accent']).toBe('#22c55e')
  })

  it('缺省或非法时回退到默认色', () => {
    expect(accentStyle({}, false)['--accent']).toBe('#6366f1')
    expect(accentStyle({ accentColorLight: 'bad', accentColorDark: 'bad' }, true)['--accent']).toBe('#818cf8')
  })
})
