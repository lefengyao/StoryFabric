import { BookOpen, FolderSync, ListTree, Network, Settings as SettingsIcon, Sparkles, Users, Waypoints } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useWorkspace } from '../stores/workspaceStore'
import { cn } from '../lib/utils'

const NAV_ITEMS = [
  { to: '/characters', icon: Users, label: '人物' },
  { to: '/relations', icon: Network, label: '关系' },
  { to: '/outline', icon: ListTree, label: '大纲' },
  { to: '/events', icon: Waypoints, label: '事件' },
  { to: '/chapters', icon: BookOpen, label: '章节' },
  { to: '/chat', icon: Sparkles, label: '智能体' }
]

const TITLE_MAP: Record<string, string> = {
  characters: '人物',
  relations: '人物关系',
  outline: '故事大纲',
  events: '事件脉络',
  chapters: '章节正文',
  chat: '智能体工作台',
  settings: '设置'
}

export function AppLayout(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const close = useWorkspace((s) => s.close)
  const refresh = useWorkspace((s) => s.refresh)
  const location = useLocation()
  const seg = location.pathname.split('/')[1] ?? ''
  const title = TITLE_MAP[seg] ?? ''

  return (
    <div className="flex h-full">
      {/* 左侧导航栏 */}
      <aside className="flex w-16 shrink-0 flex-col items-center border-r border-line bg-panel py-4 gap-1.5">
        <NavLink to="/chat" title="StoryFabric" className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
          <Sparkles size={18} />
        </NavLink>
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated hover:text-fg'
              )
            }
          >
            <Icon size={18} />
            <span className="pointer-events-none absolute left-12 z-30 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-xs text-fg opacity-0 shadow-md transition-opacity group-hover:opacity-100">
              {label}
            </span>
          </NavLink>
        ))}
        <div className="flex-1" />
        <NavLink
          to="/settings"
          title="设置"
          className={({ isActive }) =>
            cn('flex h-10 w-10 items-center justify-center rounded-lg transition-colors', isActive ? 'text-accent bg-accent-soft' : 'text-muted hover:bg-elevated hover:text-fg')
          }
        >
          <SettingsIcon size={18} />
        </NavLink>
      </aside>

      {/* 内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <h1 className="text-sm font-semibold">{title}</h1>
          <div className="flex-1" />
          <button
            onClick={() => void refresh()}
            title="重新加载工作区"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg transition cursor-pointer"
          >
            <FolderSync size={14} />
            <span className="max-w-40 truncate">{summary?.name}</span>
          </button>
          <button
            onClick={() => void close()}
            title="关闭当前工作区"
            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg transition cursor-pointer"
          >
            切换工作区
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
