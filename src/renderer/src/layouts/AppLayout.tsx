import { BarChart3, BookOpen, Download, FileText, FolderSync, ListTree, Network, Settings as SettingsIcon, Sparkles, StickyNote, Upload, Users, Waypoints } from 'lucide-react'
import { useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AppLogo } from '../components/icons/AppLogo'
import { useSettings } from '../stores/settingsStore'
import { useWorkspace } from '../stores/workspaceStore'
import { cn } from '../lib/utils'
import { api } from '../lib/api'
import { readWorkspaceArchiveFile, WORKSPACE_ARCHIVE_ACCEPT } from '../lib/workspaceArchiveFile'
import { getPlatformApi } from '../platform/platformApi'
import { HttpPlatformApi } from '../platform/httpApi'

const NAV_ITEMS = [
  { to: '/characters', icon: Users, label: '人物', load: () => import('../pages/characters/CharactersPage') },
  { to: '/relations', icon: Network, label: '关系', load: () => import('../pages/relations/RelationsPage') },
  { to: '/outline', icon: ListTree, label: '大纲', load: () => import('../pages/outline/OutlinePage') },
  { to: '/events', icon: Waypoints, label: '事件', load: () => import('../pages/events/EventsPage') },
  { to: '/chapters', icon: BookOpen, label: '章节', load: () => import('../pages/chapters/ChaptersPage') },
  { to: '/settings-docs', icon: FileText, label: '设定', load: () => import('../pages/settingsDocs/SettingsDocsPage') },
  { to: '/notes', icon: StickyNote, label: '便签', load: () => import('../pages/notes/NotesPage') },
  { to: '/usage', icon: BarChart3, label: '用量', load: () => import('../pages/usage/UsagePage') },
  { to: '/chat', icon: Sparkles, label: '智能体', load: () => import('../pages/chat/ChatPage') }
]

/** 提前拉取路由 chunk，避免首次进入某页时闪一下 Spinner；失败静默（真跳转时还会再拉一次）。 */
const prefetch = (load: () => Promise<unknown>): void => {
  void load().catch(() => {})
}
const loadSettingsPage = (): Promise<unknown> => import('../pages/settings/SettingsPage')

const TITLE_MAP: Record<string, string> = {
  characters: '人物',
  relations: '人物关系',
  outline: '故事大纲',
  events: '事件脉络',
  chapters: '章节正文',
  chat: '智能体工作台',
  settings: '设置'
  , 'settings-docs': '设定资料'
  , notes: '便签'
  , usage: '模型用量'
}

export function AppLayout(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const close = useWorkspace((s) => s.close)
  const refresh = useWorkspace((s) => s.refresh)
  const importArchive = useWorkspace((s) => s.importArchive)
  const settings = useSettings((s) => s.settings)
  const updateSettings = useSettings((s) => s.update)
  const location = useLocation()
  const seg = location.pathname.split('/')[1] ?? ''
  const title = TITLE_MAP[seg] ?? ''
  const importInput = useRef<HTMLInputElement>(null)
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const isAndroid = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
  const isRemote = getPlatformApi() instanceof HttpPlatformApi

  const downloadArchive = async (): Promise<void> => {
    setTransferBusy(true); setTransferError(null)
    try {
      const archive = await api.exportWorkspace()
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && api.shareWorkspaceArchive) {
        await api.shareWorkspaceArchive(archive)
        return
      }
      const a = document.createElement('a')
      const url = URL.createObjectURL(new Blob([archive.bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }))
      a.href = url
      a.download = archive.fileName
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (err) { setTransferError(err instanceof Error ? err.message : String(err)) }
    finally { setTransferBusy(false) }
  }

  const readArchive = async (file: File): Promise<void> => {
    setTransferBusy(true); setTransferError(null)
    try {
      const bytes = await readWorkspaceArchiveFile(file)
      if (!isRemote && !isAndroid) {
        const parentDir = await api.pickFolder()
        if (!parentDir) throw new Error('请选择导入工作区的目标文件夹')
        await importArchive(bytes, file.name, { parentDir })
      } else {
        await importArchive(bytes, file.name)
      }
    } catch (err) { setTransferError(err instanceof Error ? err.message : String(err)) }
    finally { setTransferBusy(false); if (importInput.current) importInput.current.value = '' }
  }

  const modelOptions = (settings?.providers ?? []).filter((p) => p.models.length > 0)
  const modelValue = settings?.defaultChatModel ? `${settings.defaultChatModel.providerId}::${settings.defaultChatModel.model}` : ''

  const changeModel = async (v: string): Promise<void> => {
    if (!v) return
    const [providerId, model] = v.split('::')
    await updateSettings({ defaultChatModel: { providerId, model } })
  }

  return (
    <div className="flex h-full min-h-0 flex-col sm:flex-row">
      {/* 左侧导航栏 */}
      <aside className="mobile-bottom-nav order-2 flex min-h-[76px] w-full shrink-0 items-center justify-start gap-1 overflow-x-auto border-t-2 border-line bg-panel px-1 pb-[max(env(safe-area-inset-bottom),24px)] shadow-[0_-3px_10px_rgba(0,0,0,0.08)] sm:order-none sm:min-h-0 sm:h-full sm:w-16 sm:flex-col sm:justify-start sm:gap-1.5 sm:overflow-visible sm:border-t-0 sm:border-r sm:px-0 sm:py-4 sm:pb-0 sm:shadow-none">
        <NavLink to="/chat" title="织章 · StoryFabric" className="hidden mb-3 h-9 w-9 items-center justify-center rounded-xl shadow-sm sm:flex">
          <AppLogo size={36} className="rounded-[9px]" />
        </NavLink>
        {NAV_ITEMS.map(({ to, icon: Icon, label, load }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            onMouseEnter={() => prefetch(load)}
            onFocus={() => prefetch(load)}
            onTouchStart={() => prefetch(load)}
            className={({ isActive }) =>
              cn(
                'group relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl transition-colors sm:h-10 sm:w-10 sm:rounded-lg',
                isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated hover:text-fg'
              )
            }
          >
            <Icon size={18} />
            <span className="pointer-events-none absolute bottom-12 z-30 hidden whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-xs text-fg opacity-0 shadow-md transition-opacity group-hover:opacity-100 sm:bottom-auto sm:left-12 sm:block">
              {label}
            </span>
          </NavLink>
        ))}
        <div className="hidden flex-1 sm:block" />
        <NavLink
          to="/settings"
          title="设置"
          onMouseEnter={() => prefetch(loadSettingsPage)}
          onFocus={() => prefetch(loadSettingsPage)}
          onTouchStart={() => prefetch(loadSettingsPage)}
          className={({ isActive }) =>
            cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors', isActive ? 'text-accent bg-accent-soft' : 'text-muted hover:bg-elevated hover:text-fg')
          }
        >
          <SettingsIcon size={18} />
        </NavLink>
      </aside>

      {/* 内容区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-2 sm:h-12 sm:flex-nowrap sm:px-4 sm:py-0">
          <h1 className="text-sm font-semibold">{title}</h1>
          <div className="flex-1" />
          {/* 便捷模型快选：全局默认对话模型 */}
          {modelOptions.length > 0 && (
            <select
              value={modelValue}
              onChange={(e) => void changeModel(e.target.value)}
              title="默认对话模型（智能体工作台同步使用）"
              className="h-7 max-w-52 rounded-lg border border-line bg-panel px-2 text-xs text-muted outline-none focus:border-accent cursor-pointer"
            >
              {!modelValue && <option value="">选择模型…</option>}
              {modelOptions.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {p.models.map((m) => (
                    <option key={m} value={`${p.id}::${m}`}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <button
            onClick={() => void refresh()}
            disabled={transferBusy}
            title="重新加载工作区"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg transition cursor-pointer disabled:opacity-50"
          >
            <FolderSync size={14} />
            <span className="max-w-28 truncate sm:max-w-40">{summary?.name}</span>
          </button>
          <button onClick={() => void downloadArchive()} disabled={transferBusy} title="导出工作区" className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg transition cursor-pointer disabled:opacity-50">
            <Download size={14} />
          </button>
          <button onClick={() => importInput.current?.click()} disabled={transferBusy} title="导入工作区" className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg transition cursor-pointer disabled:opacity-50">
            <Upload size={14} />
          </button>
          <input ref={importInput} type="file" accept={WORKSPACE_ARCHIVE_ACCEPT} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readArchive(file) }} />
          <button
            onClick={() => void close()}
            disabled={transferBusy}
            title="关闭当前工作区"
            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg transition cursor-pointer disabled:opacity-50"
          >
            切换工作区
          </button>
        </header>
        {transferError && <div className="border-b border-danger/30 bg-danger-soft px-4 py-1 text-xs text-danger">{transferError}</div>}
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
