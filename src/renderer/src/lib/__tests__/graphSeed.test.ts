import { describe, expect, it } from 'vitest'
import { seedPosition } from '../graphSeed'

describe('seedPosition', () => {
  it('同一 id 始终得到同一坐标', () => {
    expect(seedPosition('char_a')).toEqual(seedPosition('char_a'))
  })

  it('不同 id 得到不同坐标', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `char_${i}`)
    const xs = new Set(ids.map((id) => seedPosition(id).x))
    expect(xs.size).toBeGreaterThan(45)
  })

  it('坐标落在半径范围内', () => {
    for (const id of ['a', 'b', 'char_zzz', '中文 id']) {
      const { x, y } = seedPosition(id, 400)
      expect(Math.abs(x)).toBeLessThanOrEqual(200)
      expect(Math.abs(y)).toBeLessThanOrEqual(200)
    }
  })

  it('半径可调', () => {
    const { x } = seedPosition('char_a', 1000)
    expect(Math.abs(x)).toBeLessThanOrEqual(500)
  })
})
