import { BarChart3, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, EmptyState, Spinner } from '../../components/ui/primitives'
import { getPlatformApi } from '../../platform/platformApi'
import { summarizeUsage } from '../../../../core/usage/usageLog'
import type { UsageRecord } from '../../../../shared/types'

const nf = new Intl.NumberFormat('zh-CN')
const fmt = (value: number): string => nf.format(Math.round(value))
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`

export function UsagePage(): React.ReactElement {
  const [records, setRecords] = useState<UsageRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    try {
      setRecords(await getPlatformApi().getUsageRecords())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (error) return <div className="p-6 text-sm text-danger">{error}</div>
  if (!records) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const stats = summarizeUsage(records, { days: 14 })
  const maxDay = Math.max(1, ...stats.byDay.map((day) => day.promptTokens + day.completionTokens))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">模型用量</h1>
            <p className="mt-1 text-xs leading-5 text-muted">
              记录最近 {fmt(records.length)} 次调用，保存在本机。缓存命中率 = 命中缓存的输入 token ÷ 输入 token。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw size={13} /> 刷新
          </Button>
        </div>

        {records.length === 0 ? (
          <Card>
            <EmptyState icon={<BarChart3 size={26} />} title="还没有用量记录" hint="在智能体里对话一次，这里就会出现该次调用的 token 统计" />
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4">
                <div className="text-xs text-muted">调用次数</div>
                <div className="mt-1 text-xl font-semibold">{fmt(stats.calls)}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted">输入 / 输出 token</div>
                <div className="mt-1 text-xl font-semibold">
                  {fmt(stats.promptTokens)} / {fmt(stats.completionTokens)}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted">平均缓存命中</div>
                <div className="mt-1 text-xl font-semibold">{pct(stats.cacheHitRate)}</div>
                <div className="mt-0.5 text-xs text-faint">命中 {fmt(stats.cachedTokens)} token</div>
              </Card>
            </div>

            <section>
              <h2 className="mb-3 text-sm font-semibold">按模型</h2>
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 text-left font-medium">模型</th>
                      <th className="px-4 py-2 text-right font-medium">调用</th>
                      <th className="px-4 py-2 text-right font-medium">输入</th>
                      <th className="px-4 py-2 text-right font-medium">输出</th>
                      <th className="px-4 py-2 text-right font-medium">缓存命中</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byModel.map((item) => (
                      <tr key={`${item.providerId}::${item.model}`} className="border-b border-line/60 last:border-0">
                        <td className="px-4 py-2">
                          <div className="font-medium">{item.model}</div>
                          <div className="text-[11px] text-faint">{item.providerName}</div>
                        </td>
                        <td className="px-4 py-2 text-right">{fmt(item.calls)}</td>
                        <td className="px-4 py-2 text-right">{fmt(item.promptTokens)}</td>
                        <td className="px-4 py-2 text-right">{fmt(item.completionTokens)}</td>
                        <td className="px-4 py-2 text-right">{pct(item.cacheHitRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold">最近 14 天</h2>
              <Card className="space-y-1.5 p-4">
                {stats.byDay.map((day) => {
                  const total = day.promptTokens + day.completionTokens
                  return (
                    <div key={day.date} className="flex items-center gap-3 text-xs">
                      <span className="w-20 shrink-0 text-faint">{day.date.slice(5)}</span>
                      <div className="h-3 min-w-0 flex-1 rounded bg-elevated">
                        <div className="h-3 rounded bg-accent" style={{ width: `${(total / maxDay) * 100}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-muted">{total > 0 ? `${fmt(total)} token` : '—'}</span>
                    </div>
                  )
                })}
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
