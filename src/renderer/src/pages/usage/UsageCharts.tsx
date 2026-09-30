const number = new Intl.NumberFormat('zh-CN')
const fmt = (value: number): string => number.format(Math.round(value))

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function UsageTokenPie({ promptTokens, completionTokens }: { promptTokens: number; completionTokens: number }): React.ReactElement {
  const input = nonnegative(promptTokens)
  const output = nonnegative(completionTokens)
  const total = input + output
  const inputPercent = total ? (input / total) * 100 : 0
  const outputPercent = total ? (output / total) * 100 : 0

  return (
    <div data-android-token-pie className="mt-2 flex items-center gap-4">
      <div
        role="img"
        aria-label={`输入 ${fmt(input)} token，占 ${inputPercent.toFixed(1)}%；输出 ${fmt(output)} token，占 ${outputPercent.toFixed(1)}%`}
        className="size-24 shrink-0 rounded-full"
        style={{ background: total ? `conic-gradient(var(--accent) 0 ${inputPercent}%, var(--coral) ${inputPercent}% 100%)` : 'var(--elevated)' }}
      />
      <div className="min-w-0 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-sm bg-accent" />
          <span className="text-muted">输入</span>
          <span className="font-medium tabular-nums">{fmt(input)}</span>
          <span className="text-faint">{inputPercent.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-sm bg-coral" />
          <span className="text-muted">输出</span>
          <span className="font-medium tabular-nums">{fmt(output)}</span>
          <span className="text-faint">{outputPercent.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  )
}

export interface UsageBarDatum {
  key: string
  label: string
  description: string
  calls: number
  promptTokens: number
  completionTokens: number
}

export function UsageBarChart({
  items,
  minWidth,
  selectedKey,
  onSelect
}: {
  items: UsageBarDatum[]
  minWidth: number
  selectedKey?: string
  onSelect?: (key: string) => void
}): React.ReactElement {
  const maxTotal = Math.max(1, ...items.map((item) => nonnegative(item.promptTokens) + nonnegative(item.completionTokens)))

  return (
    <div className="overflow-x-auto pb-1">
      <div data-android-usage-bars className="flex gap-1.5" style={{ minWidth }}>
        {items.map((item) => {
          const input = nonnegative(item.promptTokens)
          const output = nonnegative(item.completionTokens)
          const total = input + output
          const barHeight = total ? Math.max(2, (total / maxTotal) * 100) : 0
          const detail = `${item.description}：${item.calls} 次调用，输入 ${fmt(input)} token，输出 ${fmt(output)} token`
          const bar = (
            <div className="flex h-44 w-full flex-col justify-end border-b border-line/70 pb-0.5">
              {total ? (
                <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${barHeight}%` }}>
                  <div className="w-full bg-accent" style={{ height: `${(input / total) * 100}%` }} />
                  <div className="w-full bg-coral" style={{ height: `${(output / total) * 100}%` }} />
                </div>
              ) : <div className="h-0.5 w-full bg-elevated" />}
            </div>
          )
          return (
            <div key={item.key} className="min-w-0 flex-1 text-center">
              {onSelect ? (
                <button
                  type="button"
                  aria-label={`${detail}；点击查看逐小时分布`}
                  aria-pressed={selectedKey === item.key}
                  title={detail}
                  onClick={() => onSelect(item.key)}
                  className={`w-full rounded-md px-1 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${selectedKey === item.key ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-elevated'}`}
                >
                  {bar}
                </button>
              ) : (
                <div role="img" tabIndex={0} aria-label={detail} title={detail} className="rounded-md px-1 focus-visible:outline-2 focus-visible:outline-accent">
                  {bar}
                </div>
              )}
              <span className={`mt-1 block truncate text-[10px] tabular-nums ${selectedKey === item.key ? 'font-semibold text-accent' : 'text-faint'}`}>{item.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
