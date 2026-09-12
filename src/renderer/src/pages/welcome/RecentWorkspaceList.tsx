import { BookOpen, History, Loader2 } from 'lucide-react'
import type { WorkspaceListItem } from '../../../../shared/types'
import { Button } from '../../components/ui/primitives'

export type RecentWorkspaceListProps = {
  items: WorkspaceListItem[]
  loading: boolean
  error: string | null
  openingPath: string | null
  onOpen: (path: string) => void | Promise<void>
  onRetry: () => void | Promise<void>
}

export function triggerRecentWorkspaceOpen(
  path: string,
  openingPath: string | null,
  onOpen: (path: string) => void | Promise<void>
): void {
  if (openingPath !== null) return
  void onOpen(path)
}

export function triggerRecentWorkspaceRetry(onRetry: () => void | Promise<void>): void {
  void onRetry()
}

export function formatOpenedAt(value: string | undefined): string {
  if (!value) return '暂无最近打开时间'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '暂无最近打开时间'

  const pad = (part: number): string => String(part).padStart(2, '0')
  return `最近打开：${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function RecentWorkspaceList({ items, loading, error, openingPath, onOpen, onRetry }: RecentWorkspaceListProps): React.ReactElement {
  const visibleItems = items.slice(0, 5)

  return (
    <section aria-labelledby="recent-workspaces-title" className="min-w-0">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg">
        <History size={15} />
        <h2 id="recent-workspaces-title">最近工作区</h2>
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted" aria-live="polite">
          <Loader2 size={15} className="animate-spin" />
          正在加载最近工作区
        </div>
      )}

      {!loading && error && (
        <div className="space-y-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-3" role="alert">
          <p className="text-sm text-danger">{error}</p>
          <Button size="sm" variant="outline" onClick={() => triggerRecentWorkspaceRetry(onRetry)}>重试</Button>
        </div>
      )}

      {!loading && !error && visibleItems.length === 0 && (
        <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-sm text-muted">
          还没有最近工作区
        </div>
      )}

      {!loading && visibleItems.length > 0 && (
        <div className="space-y-2">
          {visibleItems.map((item) => {
            const isOpening = openingPath === item.path
            return (
              <Button
                key={item.path}
                type="button"
                variant="outline"
                size="md"
                disabled={openingPath !== null}
                loading={isOpening}
                title={item.path}
                onClick={(event) => { event.stopPropagation(); triggerRecentWorkspaceOpen(item.path, openingPath, onOpen) }}
                className={`h-auto min-h-10 w-full min-w-0 justify-start gap-2.5 whitespace-normal px-3 py-2.5 text-left transition ${isOpening ? 'cursor-wait' : 'hover:bg-elevated'}`}
              >
                <BookOpen size={16} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-faint">{formatOpenedAt(item.lastOpenedAt)}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-accent">打开</span>
              </Button>
            )
          })}
        </div>
      )}
    </section>
  )
}
