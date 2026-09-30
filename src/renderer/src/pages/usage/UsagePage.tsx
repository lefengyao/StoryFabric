import { BarChart3, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, EmptyState, Spinner } from '../../components/ui/primitives'
import { getPlatformApi } from '../../platform/platformApi'
import { summarizeUsageBuckets, summarizeUsageBucketHours, usageDateKey, usageModelKey } from '../../../../core/usage/usageLog'
import type { UsageBucket } from '../../../../core/usage/usageArchive'
import type { WritingDay } from '../../../../core/usage/writingStats'
import type { UsageRecord, WorkspaceListItem } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'
import { usageProjectOptions } from './usageProjects'
import { UsageBarChart, UsageTokenPie } from './UsageCharts'
import { summarizeWritingDays } from './writingSummary'

const nf = new Intl.NumberFormat('zh-CN')
const fmt = (value: number): string => nf.format(Math.round(value))
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`

export function UsagePage(): React.ReactElement {
  const currentWorkspace = useWorkspace((state) => state.summary)
  const [records, setRecords] = useState<UsageRecord[] | null>(null)
  const [buckets, setBuckets] = useState<UsageBucket[]>([])
  const [writingDays, setWritingDays] = useState<Array<WritingDay & { workspaceId: string }>>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [writingMonth, setWritingMonth] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    try {
      const api = getPlatformApi()
      const nextWorkspaces = api.listWorkspaces().catch(() => [] as WorkspaceListItem[])
      const [nextRecords, nextBuckets, nextWritingDays] = await Promise.all([api.getUsageRecords(), api.getUsageBuckets(), api.getWritingDays()])
      setRecords(nextRecords)
      setBuckets(nextBuckets)
      setWritingDays(nextWritingDays)
      setError(null)
      void nextWorkspaces.then(setWorkspaces)
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

  const projects = usageProjectOptions([...buckets, ...writingDays], workspaces, currentWorkspace)
  const activeWorkspaceId = selectedWorkspaceId && projects.some((project) => project.id === selectedWorkspaceId) ? selectedWorkspaceId : null
  const selectedProject = projects.find((project) => project.id === activeWorkspaceId)
  const projectNames = new Map<string, number>()
  for (const project of projects) projectNames.set(project.name, (projectNames.get(project.name) ?? 0) + 1)
  const projectBuckets = buckets.filter((bucket) => !activeWorkspaceId || bucket.workspaceId === activeWorkspaceId)
  const unattributedCount = buckets.filter((bucket) => !bucket.workspaceId).reduce((sum, bucket) => sum + bucket.calls, 0)
  const allStats = summarizeUsageBuckets(projectBuckets, { days: 14 })
  const selectedModel = allStats.byModel.find((item) => usageModelKey(item.providerId, item.model) === selectedModelKey)
  const activeModelKey = selectedModel ? selectedModelKey : null
  const scopedBuckets = projectBuckets.filter((bucket) => !activeModelKey || usageModelKey(bucket.providerId, bucket.model) === activeModelKey)
  const stats = summarizeUsageBuckets(scopedBuckets, { days: 14 })
  const recordedDates = scopedBuckets.filter((bucket) => Number.isFinite(bucket.hourStart)).map((bucket) => usageDateKey(bucket.hourStart)).sort()
  const earliestDate = [recordedDates[0], stats.byDay[0]?.date].filter((date): date is string => !!date).sort()[0]
  const latestDate = [recordedDates.at(-1), stats.byDay.at(-1)?.date].filter((date): date is string => !!date).sort().at(-1)
  const activeDate = selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    ? selectedDate
    : [...stats.byDay].reverse().find((day) => day.calls > 0)?.date ?? recordedDates.at(-1) ?? stats.byDay.at(-1)?.date ?? ''
  const hourly = summarizeUsageBucketHours(scopedBuckets, activeDate)
  const activeDay = hourly.reduce((total, hour) => ({
    calls: total.calls + hour.calls,
    promptTokens: total.promptTokens + hour.promptTokens,
    completionTokens: total.completionTokens + hour.completionTokens
  }), { calls: 0, promptTokens: 0, completionTokens: 0 })
  const windowTokens = stats.byDay.reduce((total, day) => total + day.promptTokens + day.completionTokens, 0)
  const writing = summarizeWritingDays(writingDays, activeWorkspaceId)
  const months = [...new Set(writing.map((day) => day.date.slice(0, 7)))].reverse()
  const activeWritingMonth = writingMonth && months.includes(writingMonth) ? writingMonth : months[0]
  const monthWriting = writing.filter((day) => day.date.startsWith(activeWritingMonth ?? ''))
  const latestWriting = writing.at(-1)
  const totalAdded = writing.reduce((sum, day) => sum + day.added, 0)
  const totalDeleted = writing.reduce((sum, day) => sum + day.deleted, 0)

  return (
    <div data-android-usage-page className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">统计</h1>
            <p className="mt-1 text-xs leading-5 text-muted">
              模型调用按小时长期汇总；最近 {fmt(records.length)} 条明细用于排查。缓存命中率 = 命中缓存的输入 token ÷ 输入 token。
              图表展示最近 14 天及所选日期的本地时间分布。
              {unattributedCount > 0 && ` 其中 ${fmt(unattributedCount)} 次旧调用没有项目归属，仅计入全部项目。`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw size={13} /> 刷新
          </Button>
        </div>

        <Card className="flex flex-wrap items-center gap-3 p-4">
          <label htmlFor="usage-project-filter" className="shrink-0 text-xs font-medium text-muted">查看项目</label>
          <select
            id="usage-project-filter"
            className="set-select min-w-40 max-w-md flex-1"
            value={activeWorkspaceId ?? ''}
            onChange={(event) => {
              setSelectedWorkspaceId(event.target.value || null)
              setSelectedModelKey(null)
              setSelectedDate(null)
            }}
          >
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {(projectNames.get(project.name) ?? 0) > 1 ? `${project.name} · ${project.id}` : project.name}
              </option>
            ))}
          </select>
          <label htmlFor="usage-model-filter" className="shrink-0 text-xs font-medium text-muted">查看模型</label>
          <select
            id="usage-model-filter"
            className="set-select min-w-40 max-w-md flex-1"
            value={activeModelKey ?? ''}
            onChange={(event) => {
              setSelectedModelKey(event.target.value || null)
              setSelectedDate(null)
            }}
          >
            <option value="">全部模型</option>
            {allStats.byModel.map((item) => (
              <option key={usageModelKey(item.providerId, item.model)} value={usageModelKey(item.providerId, item.model)}>
                {item.providerName} / {item.model}
              </option>
            ))}
          </select>
          <span className="text-xs text-faint">当前：{selectedProject?.name ?? '全部项目'} / {selectedModel?.model ?? '全部模型'}</span>
        </Card>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">写作字数</h2>
              <p className="mt-1 text-xs text-muted">按章节保存记录新增、删除和净增；项目总字数为最近一次保存后的值。历史按月保留。</p>
            </div>
            {months.length > 0 && <select aria-label="选择写作统计月份" className="set-select" value={activeWritingMonth} onChange={(event) => setWritingMonth(event.target.value)}>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select>}
          </div>
          {writing.length === 0 ? <Card className="p-4 text-xs text-muted">保存章节后，这里会开始记录每日字数。</Card> : <>
            <div className="grid gap-3 sm:grid-cols-4">
              {([['当前项目字数', latestWriting?.totalWords ?? 0], ['累计新增', totalAdded], ['累计删除', totalDeleted], ['累计净增', totalAdded - totalDeleted]] as const).map(([label, value]) => <Card key={label} className="p-4"><div className="text-xs text-muted">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{fmt(value)}</div></Card>)}
            </div>
            <Card className="max-h-80 overflow-auto p-0"><table className="w-full text-xs"><thead className="sticky top-0 bg-panel text-muted"><tr className="border-b border-line"><th className="px-4 py-2 text-left">日期</th><th className="px-4 py-2 text-right">新增</th><th className="px-4 py-2 text-right">删除</th><th className="px-4 py-2 text-right">净增</th><th className="px-4 py-2 text-right">项目总字数</th></tr></thead><tbody>{[...monthWriting].reverse().map((day) => <tr key={day.date} className="border-b border-line/60 last:border-0"><td className="px-4 py-2">{day.date}</td><td className="px-4 py-2 text-right text-accent">+{fmt(day.added)}</td><td className="px-4 py-2 text-right text-coral">−{fmt(day.deleted)}</td><td className="px-4 py-2 text-right">{day.net > 0 ? '+' : ''}{fmt(day.net)}</td><td className="px-4 py-2 text-right">{fmt(day.totalWords)}</td></tr>)}</tbody></table></Card>
          </>}
        </section>

        <h2 className="text-sm font-semibold">模型用量</h2>
        {projectBuckets.length === 0 ? (
          <Card>
            <EmptyState icon={<BarChart3 size={26} />} title={activeWorkspaceId ? '该项目还没有用量记录' : '还没有用量记录'} hint="在智能体里对话一次，这里就会出现该次调用的 token 统计" />
          </Card>
        ) : (
          <>
            <div data-android-usage-stats className="grid gap-3 sm:grid-cols-[1fr_1.6fr_1fr]">
              <Card className="p-4">
                <div className="text-xs text-muted">调用次数</div>
                <div className="mt-1 text-xl font-semibold">{fmt(stats.calls)}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted">输入 / 输出 token</div>
                <UsageTokenPie promptTokens={stats.promptTokens} completionTokens={stats.completionTokens} />
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted">平均缓存命中</div>
                <div className="mt-1 text-xl font-semibold">{pct(stats.cacheHitRate)}</div>
                <div className="mt-0.5 text-xs text-faint">命中 {fmt(stats.cachedTokens)} token</div>
              </Card>
            </div>

            <section>
              <h2 className="mb-3 text-sm font-semibold">按模型 · 长期汇总</h2>
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
                    {allStats.byModel.map((item) => {
                      const key = usageModelKey(item.providerId, item.model)
                      return (
                        <tr key={key} className={`border-b border-line/60 last:border-0 ${activeModelKey === key ? 'bg-accent-soft' : ''}`}>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              className="text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                              aria-label={`查看 ${item.providerName} 的 ${item.model} 用量`}
                              onClick={() => { setSelectedModelKey(activeModelKey === key ? null : key); setSelectedDate(null) }}
                            >
                              <span className="block font-medium">{item.model}</span>
                              <span className="block text-[11px] text-faint">{item.providerName}</span>
                            </button>
                          </td>
                          <td className="px-4 py-2 text-right">{fmt(item.calls)}</td>
                          <td className="px-4 py-2 text-right">{fmt(item.promptTokens)}</td>
                          <td className="px-4 py-2 text-right">{fmt(item.completionTokens)}</td>
                          <td className="px-4 py-2 text-right">{pct(item.cacheHitRate)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            </section>

            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-sm font-semibold">最近 14 天</h2>
                <span className="text-xs text-muted">合计 {fmt(windowTokens)} token · 点击日期查看逐小时</span>
              </div>
              <Card className="space-y-3 p-4">
                <div className="flex gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><i aria-hidden="true" className="size-2.5 rounded-sm bg-accent" />输入</span>
                  <span className="flex items-center gap-1.5"><i aria-hidden="true" className="size-2.5 rounded-sm bg-coral" />输出</span>
                </div>
                <UsageBarChart
                  minWidth={620}
                  selectedKey={activeDate}
                  onSelect={setSelectedDate}
                  items={stats.byDay.map((day) => ({ key: day.date, label: day.date.slice(5), description: day.date, calls: day.calls, promptTokens: day.promptTokens, completionTokens: day.completionTokens }))}
                />
              </Card>
            </section>

            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-sm font-semibold">{activeDate} · 每小时用量</h2>
                <label className="flex items-center gap-2 text-xs text-muted">
                  选择日期
                  <input
                    aria-label="选择用量日期"
                    type="date"
                    value={activeDate}
                    min={earliestDate}
                    max={latestDate}
                    onChange={(event) => setSelectedDate(event.target.value || null)}
                    className="h-8 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none focus:border-accent"
                  />
                </label>
              </div>
              <Card className="space-y-3 p-4">
                <p className="text-xs text-muted">{fmt(activeDay.calls)} 次调用 · 输入 {fmt(activeDay.promptTokens)} / 输出 {fmt(activeDay.completionTokens)} token</p>
                <div className="flex gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><i aria-hidden="true" className="size-2.5 rounded-sm bg-accent" />输入</span>
                  <span className="flex items-center gap-1.5"><i aria-hidden="true" className="size-2.5 rounded-sm bg-coral" />输出</span>
                </div>
                <UsageBarChart
                  minWidth={840}
                  items={hourly.map((hour) => {
                    const label = String(hour.hour).padStart(2, '0')
                    return { key: label, label, description: `${activeDate} ${label}:00–${label}:59`, calls: hour.calls, promptTokens: hour.promptTokens, completionTokens: hour.completionTokens }
                  })}
                />
                <p className="text-[11px] text-faint">按设备本地时区分组；横向滚动可查看全部 24 小时。</p>
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
