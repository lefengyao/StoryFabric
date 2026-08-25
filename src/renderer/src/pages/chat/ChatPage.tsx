import {
  Archive,
  ArchiveRestore,
  AtSign,
  BookOpen,
  Bot,
  ListTree,
  MessageSquarePlus,
  Network,
  Pencil,
  Send,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  Waypoints,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, ChatMessage, SessionMeta } from '../../../../shared/types'
import { Markdown } from '../../components/markdown/Markdown'
import { PendingChangeDialog } from '../../components/chat/PendingChangeDialog'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { cn, ENTITY_KIND_LABEL, formatTime } from '../../lib/utils'
import { toolArgsPreview, useChat } from '../../stores/chatStore'
import { useSettings } from '../../stores/settingsStore'
import { useWorkspace } from '../../stores/workspaceStore'

const QUICK_ACTIONS = [
  '请先查阅大纲和事件脉络，然后指出当前故事线中尚未解决的伏笔与矛盾。',
  '基于现有大纲，为下一段情节提出三个不同走向的建议，并说明各自利弊。',
  '通读全部人物卡与关系，检查是否存在设定冲突或工具性过强的扁平人物。'
]

const ATTACH_ICONS: Record<string, React.ReactElement> = {
  character: <UserRound size={12} />,
  event: <Waypoints size={12} />,
  chapter: <BookOpen size={12} />,
  outline: <ListTree size={12} />,
  relationship: <Network size={12} />
}

export function ChatPage(): React.ReactElement {
  const chat = useChat()
  const summary = useWorkspace((s) => s.summary)
  const settings = useSettings((s) => s.settings)
  const [input, setInput] = useState('')
  const [attachOpen, setAttachOpen] = useState(false)
  const [tab, setTab] = useState<'recent' | 'archived'>('recent')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const providerOptions = useMemo(() => (settings?.providers ?? []).filter((p) => p.models.length > 0), [settings])
  const defaultModel = settings?.defaultChatModel

  /* 从未选择过模型时，自动采用第一个可用模型作为默认 */
  useEffect(() => {
    if (!defaultModel && providerOptions.length > 0) {
      const p = providerOptions[0]
      void useSettings.getState().update({ defaultChatModel: { providerId: p.id, model: p.models[0] } })
    }
  }, [defaultModel, providerOptions])

  /* 自动滚动到底部 */
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length, chat.streamingText, chat.liveTools.length])

  const visibleSessions = useMemo(
    () => chat.sessions.filter((s) => (tab === 'archived' ? s.archived : !s.archived)),
    [chat.sessions, tab]
  )
  const archivedCount = useMemo(() => chat.sessions.filter((s) => s.archived).length, [chat.sessions])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || chat.streaming || !defaultModel) return
    setInput('')
    await chat.send(text, { providerId: defaultModel.providerId, model: defaultModel.model })
  }

  const startRename = (s: SessionMeta): void => {
    setRenamingId(s.id)
    setRenameText(s.title)
  }
  const commitRename = async (): Promise<void> => {
    if (renamingId) await chat.renameSession(renamingId, renameText)
    setRenamingId(null)
  }

  /* 会话长度估算：所有消息文本字符数 */
  const totalChars = useMemo(() => chat.messages.reduce((n, m) => n + (m.text?.length ?? 0), 0), [chat.messages])

  if (!summary) return <div />

  return (
    <div className="flex h-full">
      {/* 会话列表 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="p-3 pb-2">
          <Button size="sm" variant="outline" className="w-full justify-center" onClick={chat.newSession}>
            <MessageSquarePlus size={14} /> 新会话
          </Button>
        </div>
        <div className="flex gap-1 px-3 pb-2">
          {(
            [
              ['recent', '最近'],
              ['archived', `已归档${archivedCount ? ` ${archivedCount}` : ''}`]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex-1 cursor-pointer rounded-md py-1 text-[11px] font-medium transition',
                tab === key ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {visibleSessions.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-faint">{tab === 'archived' ? '暂无归档会话' : '暂无会话'}</div>
          )}
          {visibleSessions.map((s) => (
            <div
              key={s.id}
              className={cn('group flex items-center rounded-lg transition', chat.activeId === s.id ? 'bg-accent-soft' : 'hover:bg-elevated')}
            >
              {renamingId === s.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className="min-w-0 flex-1 rounded-md border border-accent bg-panel px-2 py-1.5 text-xs outline-none"
                />
              ) : (
                <button onClick={() => void chat.openSession(s.id)} onDoubleClick={() => startRename(s)} className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left">
                  <div className={cn('truncate text-xs font-medium', chat.activeId === s.id ? 'text-accent' : 'text-fg')}>{s.title}</div>
                  <div className="text-[10px] text-faint">
                    {formatTime(s.updatedAt)} · {s.messageCount} 条
                  </div>
                </button>
              )}
              <div className="mr-1 hidden shrink-0 gap-0.5 group-hover:flex">
                <button
                  onClick={() => startRename(s)}
                  title="重命名"
                  className="rounded p-1 text-faint hover:text-fg cursor-pointer"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => void chat.setArchived(s.id, !s.archived)}
                  title={s.archived ? '取消归档' : '归档'}
                  className="rounded p-1 text-faint hover:text-accent cursor-pointer"
                >
                  {s.archived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
                </button>
                <button
                  onClick={() => void chat.removeSession(s.id)}
                  title="删除会话"
                  className="rounded p-1 text-faint hover:text-danger cursor-pointer"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 头部：会话长度 + 模型选择 */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
          <Sparkles size={15} className="text-accent" />
          <span className="text-sm font-medium">智能体工作台</span>
          {settings?.showSessionLength && chat.messages.length > 0 && (
            <span className="rounded-md bg-elevated px-2 py-0.5 text-[11px] text-muted">
              {chat.messages.length} 条 · 约{totalChars > 1000 ? `${(totalChars / 1000).toFixed(1)}k` : totalChars} 字
            </span>
          )}
          <span className="hidden text-xs text-faint xl:inline">资料不进提示词 · 需要时自动查阅</span>
          <div className="flex-1" />
          {providerOptions.length === 0 ? (
            <Badge tone="danger">尚未配置供应商，请前往设置</Badge>
          ) : (
            <select
              value={defaultModel ? `${defaultModel.providerId}::${defaultModel.model}` : ''}
              onChange={(e) => {
                const [providerId, model] = e.target.value.split('::')
                if (providerId && model) void useSettings.getState().update({ defaultChatModel: { providerId, model } })
              }}
              title="对话模型（与顶栏快选同步）"
              className="h-8 max-w-64 rounded-lg border border-line bg-panel px-2 text-xs outline-none focus:border-accent cursor-pointer"
            >
              {providerOptions.map((p) => (
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
        </div>

        {/* 消息列表 */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {chat.messages.length === 0 && !chat.streaming && (
            <div className="mx-auto max-w-xl">
              <EmptyState
                icon={<Bot size={36} />}
                title="让智能体成为你的创作搭档"
                hint="它会在需要时自行查阅人物卡、关系、大纲、事件与正文；修改项目资料前都会先请你确认。"
              />
              <div className="mt-4 space-y-2">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="w-full cursor-pointer rounded-lg border border-line bg-panel px-4 py-2.5 text-left text-xs text-muted transition hover:border-accent hover:text-fg"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-4">
            {chat.messages.map((m) => (
              <MessageItem key={m.id} msg={m} />
            ))}

            {(chat.streamingText || chat.streaming) && (
              <div className="flex gap-3">
                <Avatar icon={<Bot size={15} />} accent />
                <div className="min-w-0 flex-1">
                  <div className="rounded-xl border border-line bg-panel px-4 py-3">
                    {chat.streamingText ? <Markdown text={chat.streamingText} /> : <span className="text-xs text-faint">思考中…</span>}
                  </div>
                  {chat.liveTools.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {chat.liveTools.map((t) => (
                        <ToolChip key={t.callId} name={t.name} argsJson={t.argsJson} status={t.status} preview={t.preview} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {chat.error && <div className="rounded-lg bg-danger-soft px-4 py-2.5 text-xs text-danger">{chat.error}</div>}
          </div>
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-line p-4">
          <div className="relative mx-auto max-w-3xl">
            {chat.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {chat.attachments.map((a) => (
                  <span key={`${a.kind}_${a.id}`} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-[11px] text-accent">
                    {ATTACH_ICONS[a.kind]}
                    {a.label}
                    <button className="ml-0.5 cursor-pointer hover:opacity-70" onClick={() => chat.setAttachments(chat.attachments.filter((x) => x.id !== a.id))}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative rounded-xl border border-line bg-panel focus-within:border-accent transition">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={3}
                placeholder="和智能体聊聊你的故事……（Enter 发送 / Shift+Enter 换行）"
                className="w-full resize-none rounded-xl bg-transparent px-4 py-3 pr-24 text-sm outline-none placeholder:text-faint"
              />
              <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1">
                <AttachPicker open={attachOpen} onOpenChange={setAttachOpen} />
                {chat.streaming ? (
                  <Button variant="outline" size="sm" onClick={() => void chat.abort()} title="中止生成">
                    <Square size={13} /> 停止
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => void send()} disabled={!input.trim()}>
                    <Send size={13} /> 发送
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 写确认 */}
      {chat.pendingChange && <PendingChangeDialog change={chat.pendingChange} onConfirm={(ok) => void chat.confirmChange(ok)} />}
    </div>
  )
}

function Avatar({ icon, accent }: { icon: React.ReactElement; accent?: boolean }): React.ReactElement {
  return (
    <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', accent ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted')}>
      {icon}
    </div>
  )
}

function ToolChip({ name, argsJson, status, preview }: { name: string; argsJson: string; status: string; preview?: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-app px-2.5 py-1.5 text-[11px]">
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          status === 'running' ? 'animate-pulse bg-accent' : status === 'ok' ? 'bg-ok' : 'bg-danger'
        )}
      />
      <span className="font-mono text-accent">{name}</span>
      <span className="truncate text-faint">{toolArgsPreview(argsJson)}</span>
      {preview && <span className="ml-auto max-w-40 truncate text-faint">{preview}</span>}
    </div>
  )
}

function MessageItem({ msg }: { msg: ChatMessage }): React.ReactElement {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-accent px-4 py-2.5 text-sm leading-relaxed text-accent-fg">{msg.text}</div>
        <Avatar icon={<UserRound size={14} />} />
      </div>
    )
  }
  if (msg.role === 'tool') {
    return (
      <div className="ml-10">
        <details className="rounded-md border border-line bg-app px-2.5 py-1.5 text-[11px] text-muted open:bg-elevated">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none">
            <span className={cn('h-1.5 w-1.5 rounded-full', msg.isError ? 'bg-danger' : 'bg-ok')} />
            <span className="font-mono text-accent">{msg.toolName}</span>
            <span className="text-faint">已返回结果（点击展开）</span>
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-faint">{msg.text?.slice(0, 2000)}</pre>
        </details>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <Avatar icon={<Bot size={15} />} accent />
      <div className="min-w-0 flex-1">
        <div className={cn('rounded-xl border border-line bg-panel px-4 py-3', msg.isError && 'border-danger/40')}>
          {msg.text && <Markdown text={msg.text} />}
        </div>
      </div>
    </div>
  )
}

/** @引用选择器：从当前工作区实体中挑选并附加到消息 */
function AttachPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const attachments = useChat((s) => s.attachments)
  const setAttachments = useChat((s) => s.setAttachments)
  const [query, setQuery] = useState('')

  const candidates = useMemo(() => {
    const out: Attachment[] = []
    for (const c of summary?.characters ?? []) out.push({ kind: 'character', id: c.id, label: c.name })
    for (const e of summary?.events ?? []) out.push({ kind: 'event', id: e.id, label: e.title })
    for (const o of summary?.outline ?? []) out.push({ kind: 'outline', id: o.id, label: o.title })
    for (const ch of summary?.chapters ?? []) out.push({ kind: 'chapter', id: ch.id, label: ch.title })
    const q = query.trim().toLowerCase()
    return q ? out.filter((x) => x.label.toLowerCase().includes(q)) : out
  }, [summary, query])

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => onOpenChange(!open)} title="@引用项目实体">
        <AtSign size={14} />
      </Button>
      {open && (
        <div className="absolute bottom-12 right-0 z-30 w-72 rounded-xl border border-line bg-panel p-2 shadow-xl">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索要引用的实体…" className="mb-1.5 h-8 text-xs" />
          <div className="max-h-60 overflow-y-auto">
            {candidates.length === 0 && <div className="px-2 py-3 text-center text-xs text-faint">没有匹配项</div>}
            {candidates.map((a) => {
              const added = attachments.some((x) => x.id === a.id)
              return (
                <button
                  key={`${a.kind}_${a.id}`}
                  onClick={() => {
                    if (added) setAttachments(attachments.filter((x) => x.id !== a.id))
                    else setAttachments([...attachments, a])
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-elevated"
                >
                  <span className="text-faint">{ATTACH_ICONS[a.kind]}</span>
                  <span className="truncate text-xs">{a.label}</span>
                  <Badge className="ml-auto">{ENTITY_KIND_LABEL[a.kind]}</Badge>
                  {added && <span className="text-xs text-accent">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
