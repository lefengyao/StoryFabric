import { BarChart3, BookOpen, Download, FileText, FolderSync, Home, ListTree, Network, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings as SettingsIcon, Sparkles, StickyNote, Upload, Users, Waypoints } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { BrandMark } from '../components/icons/BrandMark'
import { useSettings } from '../stores/settingsStore'
import { useWorkspace } from '../stores/workspaceStore'
import { cn } from '../lib/utils'
import { api } from '../lib/api'
import { readSidebarExpanded, SIDEBAR_EXPANDED_KEY, writeSidebarExpanded } from '../lib/navigationPreference'
import { readWorkspaceArchiveFile, WORKSPACE_ARCHIVE_ACCEPT } from '../lib/workspaceArchiveFile'
import { getPlatformApi } from '../platform/platformApi'
import { HttpPlatformApi } from '../platform/httpApi'
import { ChatSidebar } from '../components/chat/ChatSidebar'
import { useUi } from '../stores/uiStore'

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
const getSidebarStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

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
  const [importBusy, setImportBusy] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [sidebarExpanded, setSidebarExpanded] = useState(() => readSidebarExpanded(getSidebarStorage(), true))
  const chatPanelOpen = useUi((s) => s.chatPanelOpen)
  const toggleChatPanel = useUi((s) => s.toggleChatPanel)
  const closeChatPanel = useUi((s) => s.closeChatPanel)
  const isAndroid = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
  const isRemote = getPlatformApi() instanceof HttpPlatformApi

  useEffect(() => {
    writeSidebarExpanded(getSidebarStorage(), sidebarExpanded)
  }, [sidebarExpanded])

  useEffect(() => {
    if (seg === 'chat') closeChatPanel()
  }, [seg, closeChatPanel])

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
    setTransferBusy(true); setImportBusy(true); setTransferError(null)
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
    finally { setTransferBusy(false); setImportBusy(false); if (importInput.current) importInput.current.value = '' }
  }

  const modelOptions = (settings?.providers ?? []).filter((p) => p.models.length > 0)
  const modelValue = settings?.defaultChatModel ? `${settings.defaultChatModel.providerId}::${settings.defaultChatModel.model}` : ''

  const changeModel = async (v: string): Promise<void> => {
    if (!v) return
    const [providerId, model] = v.split('::')
    await updateSettings({ defaultChatModel: { providerId, model } })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app sm:flex-row" data-app-shell>
      <aside
        data-sidebar-preference-key={SIDEBAR_EXPANDED_KEY}
        className={cn(
          'app-sidebar-scroll mobile-bottom-nav order-2 flex min-h-[74px] w-full shrink-0 items-center justify-start gap-1 overflow-x-auto border-t border-white/10 bg-[#101936] px-1 pb-[max(env(safe-area-inset-bottom),22px)] text-white/65 shadow-[0_-8px_24px_rgba(7,12,30,0.16)] sm:order-none sm:min-h-0 sm:h-full sm:flex-col sm:justify-start sm:gap-1.5 sm:overflow-x-hidden sm:overflow-y-auto sm:border-r sm:border-t-0 sm:px-3 sm:py-4 sm:pb-4 sm:shadow-none',
          sidebarExpanded ? 'sm:w-[204px]' : 'sm:w-[68px]'
        )}
      >
        <NavLink to="/chat" title="织章 · StoryFabric" className="hidden items-center gap-3 px-1 pb-5 sm:flex">
          <BrandMark variant="flat" size={38} className="shrink-0 rounded-[10px] shadow-[0_10px_24px_rgba(0,0,0,0.22)]" />
          {sidebarExpanded && (
            <span className="min-w-0">
              <strong className="block font-serif text-[19px] tracking-[0.08em] text-white">织章</strong>
              <small className="mt-1 block text-[8px] font-semibold tracking-[0.22em] text-white/[0.42]">STORYFABRIC</small>
            </span>
          )}
        </NavLink>

        {sidebarExpanded && <div className="mb-2 hidden px-3 text-[10px] font-semibold tracking-[0.16em] text-white/[0.28] sm:block">故事工作区</div>}
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
                'group relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl transition-colors sm:h-10 sm:rounded-lg',
                sidebarExpanded ? 'sm:w-full sm:justify-start sm:gap-3 sm:px-3' : 'sm:w-10',
                isActive ? 'bg-[#d85d49] text-white shadow-[0_10px_24px_rgba(216,93,73,0.24)]' : 'text-white/60 hover:bg-white/[0.08] hover:text-white'
              )
            }
          >
            <Icon size={18} />
            <span className={cn('hidden text-sm', sidebarExpanded && 'sm:inline')}>
              {label}
            </span>
            <span className={cn('pointer-events-none absolute bottom-14 z-30 hidden whitespace-nowrap rounded-md border border-white/10 bg-[#182346] px-2 py-1 text-xs text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 sm:bottom-auto sm:left-12 sm:block', sidebarExpanded && 'sm:hidden')}>
              {label}
            </span>
          </NavLink>
        ))}

        <div className="hidden flex-1 sm:block" />
        {sidebarExpanded && summary && (
          <div className="mb-2 hidden rounded-xl border border-white/[0.08] bg-white/[0.05] p-3 sm:block">
            <span className="block text-[9px] text-white/[0.36]">当前工作区</span>
            <strong className="mt-1 block w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs text-white/[0.84]" title={summary.name}>{summary.name}</strong>
            <span className="mt-1 block text-[9px] text-white/[0.34]">{summary.chapters.length} 章 · {summary.characters.length} 人</span>
          </div>
        )}
        <NavLink
          to="/settings"
          title="设置"
          onMouseEnter={() => prefetch(loadSettingsPage)}
          onFocus={() => prefetch(loadSettingsPage)}
          onTouchStart={() => prefetch(loadSettingsPage)}
          className={({ isActive }) =>
            cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
              sidebarExpanded && 'sm:w-full sm:justify-start sm:gap-3 sm:px-3',
              isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/[0.08] hover:text-white'
            )
          }
        >
          <SettingsIcon size={18} />
          <span className={cn('hidden text-sm', sidebarExpanded && 'sm:inline')}>设置</span>
        </NavLink>
        <button
          type="button"
          title={sidebarExpanded ? '收起导航' : '展开导航'}
          aria-label={sidebarExpanded ? '收起导航' : '展开导航'}
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className={cn(
            'hidden h-10 shrink-0 items-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white sm:flex',
            sidebarExpanded ? 'sm:w-full sm:justify-start sm:gap-3 sm:px-3' : 'w-10 justify-center sm:w-10'
          )}
        >
          {sidebarExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          {sidebarExpanded && <span className="hidden text-sm sm:inline">收起导航</span>}
        </button>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel/[0.92] px-3 py-2 backdrop-blur-xl sm:h-14 sm:flex-nowrap sm:px-5 sm:py-0">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => void close()}
                disabled={importBusy}
                title="返回主界面"
                aria-label="返回主界面"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs text-muted transition hover:border-accent/40 hover:text-fg disabled:opacity-50"
              >
                <Home size={14} />
                <span className="hidden sm:inline">主界面</span>
              </button>
              <div className="min-w-0">
                <h1 className="truncate font-serif text-[17px] font-semibold">{title}</h1>
                <p className="hidden truncate text-[10px] text-faint sm:block">{summary?.name ?? 'StoryFabric'}</p>
              </div>
            </div>
            <div className="flex-1" />
            {modelOptions.length > 0 && (
              <select
                value={modelValue}
                onChange={(e) => void changeModel(e.target.value)}
                title="默认对话模型"
                className="hidden h-8 max-w-52 rounded-lg border border-line bg-panel px-2 text-xs text-muted outline-none focus:border-accent cursor-pointer md:block"
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
              disabled={importBusy}
              title="重新加载工作区"
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-elevated hover:text-fg disabled:opacity-50 lg:flex"
            >
              <FolderSync size={14} />
              <span className="max-w-28 truncate xl:max-w-40">{summary?.name}</span>
            </button>
            <button onClick={() => void downloadArchive()} disabled={transferBusy} title="导出工作区" className="hidden rounded-lg p-2 text-muted transition hover:bg-elevated hover:text-fg disabled:opacity-50 lg:block">
              <Download size={14} />
            </button>
            <button onClick={() => importInput.current?.click()} disabled={transferBusy} title="导入工作区" className="hidden rounded-lg p-2 text-muted transition hover:bg-elevated hover:text-fg disabled:opacity-50 lg:block">
              <Upload size={14} />
            </button>
            <input ref={importInput} type="file" accept={WORKSPACE_ARCHIVE_ACCEPT} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readArchive(file) }} />
            <button
              onClick={() => void close()}
              disabled={importBusy}
              title="关闭当前工作区"
              className="hidden rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-elevated hover:text-fg disabled:opacity-50 xl:block"
            >
              切换工作区
            </button>
            {seg !== 'chat' && (
              <button
                type="button"
                onClick={toggleChatPanel}
                title={chatPanelOpen ? '收起智能体侧栏' : '打开智能体侧栏'}
                aria-pressed={chatPanelOpen}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition',
                  chatPanelOpen
                    ? 'border-accent/30 bg-accent-soft text-accent'
                    : 'border-line bg-panel text-muted hover:border-accent/40 hover:text-fg'
                )}
              >
                {chatPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                <span className="hidden sm:inline">智能体</span>
              </button>
            )}
          </header>
          {transferError && <div className="border-b border-danger/30 bg-danger-soft px-4 py-1 text-xs text-danger">{transferError}</div>}
          <main className="min-h-0 flex-1 overflow-hidden bg-app">
            <div className="h-full overflow-hidden bg-panel/[0.72]">
              <Outlet />
            </div>
          </main>
        </div>
        <ChatSidebar open={chatPanelOpen && seg !== 'chat'} />
      </div>
    </div>
  )
}
