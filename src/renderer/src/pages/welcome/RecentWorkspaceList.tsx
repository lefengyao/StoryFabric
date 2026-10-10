import { BookOpen, Check, History, Loader2, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import type { WorkspaceListItem } from '../../../../shared/types'
import { Button } from '../../components/ui/primitives'

export type RecentWorkspaceListProps = {
  items: WorkspaceListItem[]
  loading: boolean
  error: string | null
  openingPath: string | null
  onOpen: (path: string) => void | Promise<void>
  onRename: (path: string, name: string) => Promise<void>
  onForget: (path: string) => Promise<void>
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

export function RecentWorkspaceList({ items, loading, error, openingPath, onOpen, onRename, onForget, onRetry }: RecentWorkspaceListProps): React.ReactElement {
  const visibleItems = items.slice(0, 5)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const rename = async (path: string): Promise<void> => {
    const name = draftName.trim()
    if (!name) { setActionError('项目名称不能为空'); return }
    setBusyPath(path)
    setActionError(null)
    try {
      await onRename(path, name)
      setEditingPath(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyPath(null)
    }
  }

  const forget = async (path: string): Promise<void> => {
    setBusyPath(path)
    setActionError(null)
    try {
      await onForget(path)
      if (editingPath === path) setEditingPath(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyPath(null)
    }
  }

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
          <p className="text-[11px] text-faint">重命名只修改项目显示名称，不移动文件夹；从最近列表移除不会删除项目文件。</p>
          {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}
          {visibleItems.map((item) => {
            const isOpening = openingPath === item.path
            return (
              <div key={item.path} className="rounded-lg border border-line bg-panel p-1.5">
              <div className="flex min-w-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="md"
                disabled={openingPath !== null || busyPath !== null || editingPath !== null}
                loading={isOpening}
                title={item.path}
                onClick={(event) => { event.stopPropagation(); triggerRecentWorkspaceOpen(item.path, openingPath, onOpen) }}
                className={`h-auto min-h-10 min-w-0 flex-1 justify-start gap-2.5 border-0 bg-transparent whitespace-normal px-2 py-2 text-left transition ${isOpening ? 'cursor-wait' : 'hover:bg-elevated'}`}
              >
                <BookOpen size={16} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-faint">{formatOpenedAt(item.lastOpenedAt)}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-accent">打开</span>
              </Button>
              <button type="button" aria-label={`重命名项目：${item.name}`} title="重命名项目" disabled={openingPath !== null || busyPath !== null} onClick={() => { setEditingPath(item.path); setDraftName(item.name); setActionError(null) }} className="rounded-md p-2 text-muted hover:bg-elevated hover:text-fg disabled:opacity-50"><Pencil size={14} /></button>
              <button type="button" aria-label={`从最近列表移除：${item.name}`} title="从最近列表移除（不会删除项目文件）" disabled={openingPath !== null || busyPath !== null} onClick={() => void forget(item.path)} className="rounded-md p-2 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"><X size={14} /></button>
              </div>
              {editingPath === item.path && <div className="mt-1 flex gap-1.5 px-1 pb-1">
                <input autoFocus value={draftName} maxLength={100} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void rename(item.path); if (event.key === 'Escape') setEditingPath(null) }} aria-label="新的项目名称" className="min-w-0 flex-1 rounded-md border border-line bg-app px-2 py-1.5 text-xs text-fg outline-none focus:border-accent" />
                <button type="button" disabled={busyPath !== null} onClick={() => void rename(item.path)} className="rounded-md bg-accent px-2 text-accent-fg disabled:opacity-50" title="保存名称"><Check size={14} /></button>
                <button type="button" disabled={busyPath !== null} onClick={() => setEditingPath(null)} className="rounded-md px-2 text-muted hover:bg-elevated" title="取消改名"><X size={14} /></button>
              </div>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
