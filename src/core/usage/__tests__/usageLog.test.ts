import { describe, expect, it } from 'vitest'
import type { UsageRecord } from '../../../shared/types'
import { appendUsage, parseUsageLog, summarizeUsage } from '../usageLog'

const record = (patch: Partial<UsageRecord>): UsageRecord => ({
  at: 0,
  providerId: 'p1',
  providerName: '供应商',
  model: 'm1',
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  ...patch
})

describe('parseUsageLog', () => {
  it('解析合法数组并丢弃坏记录', () => {
    expect(parseUsageLog(JSON.stringify([record({ at: 1 }), { nope: true }]))).toHaveLength(1)
  })

  it('空值、坏 JSON、非数组都返回空数组', () => {
    expect(parseUsageLog(null)).toEqual([])
    expect(parseUsageLog('')).toEqual([])
    expect(parseUsageLog('{bad')).toEqual([])
    expect(parseUsageLog('{"a":1}')).toEqual([])
  })
})

describe('appendUsage', () => {
  it('追加并按上限裁剪最旧记录', () => {
    const first = appendUsage([], record({ at: 1 }), 2)
    const second = appendUsage(first, record({ at: 2 }), 2)
    const third = appendUsage(second, record({ at: 3 }), 2)
    expect(third.map((item) => item.at)).toEqual([2, 3])
  })
})

describe('summarizeUsage', () => {
  const now = new Date(2026, 8, 9, 12, 0, 0).getTime()
  const day = 24 * 60 * 60 * 1000

  it('汇总总量、按模型降序与缓存命中率', () => {
    const stats = summarizeUsage(
      [
        record({ at: now, model: 'a', promptTokens: 100, completionTokens: 10, cachedTokens: 40 }),
        record({ at: now, model: 'a', promptTokens: 100, completionTokens: 20, cachedTokens: 60 }),
        record({ at: now, model: 'b', promptTokens: 200, completionTokens: 50, cachedTokens: 0 })
      ],
      { now }
    )

    expect(stats.calls).toBe(3)
    expect(stats.promptTokens).toBe(400)
    expect(stats.completionTokens).toBe(80)
    expect(stats.cachedTokens).toBe(100)
    expect(stats.cacheHitRate).toBeCloseTo(0.25, 5)
    expect(stats.byModel.map((item) => item.model)).toEqual(['b', 'a'])

    const a = stats.byModel.find((item) => item.model === 'a')
    expect(a).toMatchObject({ calls: 2, promptTokens: 200, completionTokens: 30, cachedTokens: 100 })
    expect(a?.cacheHitRate).toBeCloseTo(0.5, 5)
  })

  it('按日汇总最近 N 天并补零', () => {
    const stats = summarizeUsage(
      [record({ at: now, promptTokens: 10 }), record({ at: now - day, promptTokens: 20 }), record({ at: now - 2 * day, promptTokens: 30 })],
      { now, days: 3 }
    )

    expect(stats.byDay).toHaveLength(3)
    expect(stats.byDay.map((item) => item.promptTokens)).toEqual([30, 20, 10])
    expect(stats.byDay[0].date).toBe('2026-09-07')
    expect(stats.byDay[2].date).toBe('2026-09-09')
  })

  it('空记录不产生 NaN', () => {
    const stats = summarizeUsage([], { now })
    expect(stats.calls).toBe(0)
    expect(stats.cacheHitRate).toBe(0)
    expect(stats.byModel).toEqual([])
    expect(stats.byDay.every((item) => item.calls === 0)).toBe(true)
  })

  it('忽略非法数值，不污染总量', () => {
    const stats = summarizeUsage(
      [record({ at: now, promptTokens: Number.NaN, completionTokens: Number.POSITIVE_INFINITY, cachedTokens: 5 })],
      { now }
    )
    expect(Number.isFinite(stats.promptTokens)).toBe(true)
    expect(stats.promptTokens).toBe(0)
    expect(stats.completionTokens).toBe(0)
    expect(stats.cachedTokens).toBe(5)
  })

  it('总量相同时按模型名稳定排序', () => {
    const stats = summarizeUsage(
      [record({ at: now, model: 'zzz', promptTokens: 10 }), record({ at: now, model: 'aaa', promptTokens: 10 }), record({ at: now, model: 'mmm', promptTokens: 10 })],
      { now }
    )
    expect(stats.byModel.map((item) => item.model)).toEqual(['aaa', 'mmm', 'zzz'])
  })

  it('窗口外的记录计入总量但不进 byDay', () => {
    const stats = summarizeUsage([record({ at: now, promptTokens: 10 }), record({ at: now - 30 * day, promptTokens: 90 })], { now, days: 3 })
    expect(stats.promptTokens).toBe(100)
    expect(stats.byDay.reduce((sum, item) => sum + item.promptTokens, 0)).toBe(10)
  })
})
