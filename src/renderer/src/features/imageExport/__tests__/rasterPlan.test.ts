import { describe, expect, it } from 'vitest'
import * as implementation from '../rasterPlan'
const module = implementation as unknown as Record<string, (...args: any[]) => any>

describe('bounded PNG raster plan', () => {
  it('attempts 2x and covers the entire scroll height with adjacent tiles', () => {
    expect(module.planRaster).toBeTypeOf('function')
    const plan = module.planRaster(760, 7400, false)
    expect(plan.scale).toBe(2)
    expect(plan.width).toBe(1520)
    expect(plan.height).toBe(14800)
    expect(plan.tiles[0].y).toBe(0)
    expect(plan.tiles.reduce((n: number, t: { height: number }) => n + t.height, 0)).toBe(7400)
    for (let i = 1; i < plan.tiles.length; i++) expect(plan.tiles[i].y).toBe(plan.tiles[i - 1].y + plan.tiles[i - 1].height)
  })
  it('keeps readable 1x resolution under mobile memory budget instead of shrinking content', () => {
    expect(module.planRaster).toBeTypeOf('function')
    const plan = module.planRaster(900, 7000, true)
    expect(plan.scale).toBe(1)
    expect(plan.height).toBe(7000)
  })
  it('rejects oversize single images with a clear range reduction instruction', () => {
    expect(module.planRaster).toBeTypeOf('function')
    expect(() => module.planRaster(900, 60000, true)).toThrow(/缩小|分/)
    expect(() => module.planRaster(0, 400, false)).toThrow()
  })
  it('sanitizes names without leaking paths and includes a timestamp', () => {
    expect(module.imageFileName).toBeTypeOf('function')
    const name = module.imageFileName('作品:测试', '人物/甲', new Date('2026-10-09T12:34:56.000Z'))
    expect(name).toMatch(/20261009.*\.png$/)
    expect(name).not.toMatch(/[<>:"/\\|?*]/)
    expect(name).toContain('作品_测试')
  })
})
