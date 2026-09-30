import { AtSign, Bot, Check, ChevronDown, ExternalLink, FileText, History, MessageSquarePlus, Plus, Send, Settings, Sparkles, Square, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentMode, ApprovalPolicy, ChatMessage, MessageFile } from '../../../../shared/types'
import { Markdown } from '../markdown/Markdown'
import { ContextUsageMeter, shouldShowThinking, ThinkingRow, ToolRunRow } from './AgentActivity'
import { SkillActivity } from './SkillActivity'
import { RuleActivity } from './RuleActivity'
import { RunActivityDetails } from './RunActivityDetails'
import { Button, Input } from '../ui/primitives'
import { CopyButton } from '../ui/CopyButton'
import { shouldSendOnKey } from '../../lib/sendShortcut'
import { prepareMessageFiles } from '../../lib/prepareMessageFiles'
import { cn, formatTime } from '../../lib/utils'
import { useChat } from '../../stores/chatStore'
import { useSettings } from '../../stores/settingsStore'
import { useUi } from '../../stores/uiStore'
import { useWorkspace } from '../../stores/workspaceStore'
import { AttachmentMenu } from './AttachmentMenu'
import { PendingChangeDialog } from './PendingChangeDialog'
import { resolveContextWindow } from '../../lib/modelCapability'
import { estimateTextTokens, resolveContextUsage } from '../../../../core/agent/contextWindow'
import { SYSTEM_PROMPT } from '../../../../core/agent/prompts'
import { chatDraftScope, useChatDraft } from '../../stores/chatDraftStore'
import { creativePreferencesForSurface } from '../../lib/creativePreferences'
import { agentStageLabel, agentThinkingLabel, isOrdinaryChapterAgentStage } from '../../lib/agentStagePresentation'
import { approvalPolicyPickerDisabled } from '../../stores/chatScope'
import { useChatInputAutosize } from './useChatInputAutosize'

const QUICK_QUESTIONS = [
  '检查当前章节与前文的设定冲突。',
  '指出当前故事线里尚未解决的伏笔。',
  '根据已有资料，为下一段情节提出三个走向。'
]

export function ChatSidebar({ open }: { open: boolean }): React.ReactElement {
  const chat = useChat()
  const settings = useSettings((s) => s.settings)
  const summary = useWorkspace((s) => s.summary)
  const activeLiveStage = [...chat.liveTimeline].reverse().find((item): item is Extract<typeof item, { kind: 'stage' }> => item.kind === 'stage' && item.status === 'running')?.stageId
  const uiSource = useWorkspace((s) => s.uiSource)
  const close = useUi((s) => s.closeChatPanel)
  const [attachOpen, setAttachOpen] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [referenceQuery, setReferenceQuery] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [agentMode, setAgentMode] = useState<AgentMode>('normal')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const referencePanelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      setDetailsOpen(false)
      return
    }
    if (window.Capacitor?.isNativePlatform?.()) closeButtonRef.current?.focus()
  }, [open])
  const draftScope = chatDraftScope({ source: uiSource ?? 'electron-local', path: summary?.path ?? '' }, chat.activeId)
  const input = useChatDraft(draftScope)
  const isAndroid = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
  const composerRef = useChatInputAutosize(input.text, isAndroid, settings?.chatFontSize)

  const providerOptions = useMemo(() => (settings?.providers ?? []).filter((provider) => provider.models.length > 0), [settings])
  const defaultModel = settings?.defaultChatModel
  const modelValue = defaultModel ? `${defaultModel.providerId}::${defaultModel.model}` : ''
  const selectedProvider = providerOptions.find((provider) => provider.id === defaultModel?.providerId)
  const selectedModelSettings = defaultModel ? selectedProvider?.modelSettings?.[defaultModel.model] : undefined
  const contextWindow = resolveContextWindow(defaultModel?.model ?? '', selectedModelSettings)
  const activeSession = chat.sessions.find((session) => session.id === chat.activeId)
  const activeStreaming = Boolean(chat.activeId && chat.runningSessionIds.includes(chat.activeId)) || (chat.streaming && (!chat.runningSessionId || chat.runningSessionId === chat.activeId))
  const backgroundStreaming = chat.runningSessionIds.some((id) => id !== chat.activeId) || (chat.streaming && !!chat.runningSessionId && chat.runningSessionId !== chat.activeId)
  const orchestrationEnabled = chat.creativePreferences?.orchestrationEnabled === true
  useEffect(() => { setAgentMode(orchestrationEnabled ? 'orchestration' : 'normal') }, [orchestrationEnabled, chat.activeId])
  const references = useMemo(() => {
    const candidates = [
      ...(summary?.characters ?? []).map((item) => ({ kind: 'character' as const, id: item.id, label: item.name })),
      ...(summary?.events ?? []).map((item) => ({ kind: 'event' as const, id: item.id, label: item.title })),
      ...(summary?.outline ?? []).map((item) => ({ kind: 'outline' as const, id: item.id, label: item.title })),
      ...(summary?.chapters ?? []).map((item) => ({ kind: 'chapter' as const, id: item.id, label: item.title }))
    ]
    const query = referenceQuery.trim().toLowerCase()
    return query ? candidates.filter((item) => item.label.toLowerCase().includes(query)) : candidates
  }, [summary, referenceQuery])
  const contextUsage = useMemo(() => resolveContextUsage({
    messages: chat.messages,
    contextTokens: contextWindow.contextTokens,
    maxOutputTokens: contextWindow.maxOutputTokens,
    summaryThrough: chat.contextSummaryThrough,
    summaryTokens: estimateTextTokens(chat.contextSummary),
    systemTokens: estimateTextTokens(SYSTEM_PROMPT)
  }), [chat.messages, chat.contextSummary, chat.contextSummaryThrough, contextWindow.contextTokens, contextWindow.maxOutputTokens])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [chat.messages.length, chat.liveTimeline.length, chat.liveSkillEvents.length, chat.liveRuleEvents.length])

  useEffect(() => {
    if (!open) setDetailsOpen(false)
  }, [open])

  useEffect(() => {
    if (!referenceOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (referencePanelRef.current && !referencePanelRef.current.contains(event.target as Node)) setReferenceOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setReferenceOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [referenceOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !open || chat.pendingChange) return
      if (detailsOpen) setDetailsOpen(false)
      else close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chat.pendingChange, close, detailsOpen, open])

  const send = async (): Promise<void> => {
    const text = input.text
    if ((!text && !chat.messageFiles.length && !chat.attachments.length) || (chat.activeId && chat.runningSessionIds.includes(chat.activeId))) return
    if (!defaultModel) {
      useChat.setState({ error: '请先配置默认对话模型' })
      return
    }
    await chat.send(text, { providerId: defaultModel.providerId, model: defaultModel.model, mode: orchestrationEnabled ? 'orchestration' : agentMode, creative: chat.creativePreferences ?? creativePreferencesForSurface(settings ?? undefined, 'sidebar') })
  }

  const createSession = async (): Promise<void> => {
    await chat.newSession()
    setDetailsOpen(false)
  }

  const selectSession = async (id: string): Promise<void> => {
    await chat.openSession(id)
    setDetailsOpen(false)
  }

  return (
    <div
      data-android-agent-sidebar
      className={cn(
        'chat-sidebar-flyout chat-surface fixed inset-0 z-50 overflow-hidden transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:relative sm:inset-auto sm:z-auto sm:h-full sm:shrink-0',
        open
          ? 'pointer-events-auto w-full opacity-100 sm:w-[420px] lg:w-[460px]'
          : 'pointer-events-none w-0 opacity-0 sm:w-0'
      )}
      aria-hidden={!open}
      inert={!open}
    >
    <aside data-android-agent-panel className={cn('chat-sidebar-panel absolute inset-y-0 right-0 flex w-full min-w-0 flex-col border-line bg-panel shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:w-[420px] sm:border-l lg:w-[460px]', open ? 'translate-x-0' : 'translate-x-full')}>
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
          <Sparkles size={17} />
        </span>
        <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <strong className="chat-text-body font-semibold">智能体</strong>
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          </div>
          <p className="chat-text-meta truncate text-muted">
            {activeStreaming
              ? '正在处理工作区资料…'
              : `${activeSession?.title ?? '创建会话后开始提问'}${defaultModel ? ` · ${defaultModel.model}` : ''}`}
          </p>
        </div>
        <button type="button" onClick={() => setDetailsOpen((open) => !open)} title="会话、模型与上下文" aria-label="会话、模型与上下文" aria-expanded={detailsOpen} aria-controls="chat-sidebar-details" className={cn('flex h-8 items-center gap-0.5 rounded-lg px-1.5 text-muted transition hover:bg-elevated hover:text-fg', detailsOpen && 'bg-accent-soft text-accent')}>
          <History size={16} />
          <ChevronDown size={11} className={cn('transition-transform duration-200', detailsOpen && 'rotate-180')} />
        </button>
        <button type="button" onClick={() => void createSession()} title="新建会话" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-fg">
          <MessageSquarePlus size={16} />
        </button>
        <button ref={closeButtonRef} type="button" onClick={close} title="关闭侧栏" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-fg">
          <X size={17} />
        </button>
      </header>

      {detailsOpen && (
        <button
          type="button"
          aria-label="收起智能体信息"
          onClick={() => setDetailsOpen(false)}
          className="absolute inset-0 z-30 cursor-default bg-black/5"
        />
      )}

      {detailsOpen && (
        <div id="chat-sidebar-details" className="chat-sidebar-drawer absolute left-3 right-3 top-[68px] z-40 max-h-[calc(100%-80px)] overflow-y-auto rounded-xl border border-line bg-panel shadow-[0_18px_48px_rgba(16,26,56,0.18)]">
          <section className="shrink-0 border-b border-line bg-panel px-3 py-3 shadow-[0_12px_30px_rgba(16,26,56,0.08)]">
            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <strong className="text-xs">创作会话</strong>
                <p className="mt-0.5 text-[10px] text-faint">{chat.sessions.filter((session) => !session.archived).length} 个最近会话</p>
              </div>
              <button type="button" onClick={() => void createSession()} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-coral px-2.5 text-[11px] font-medium text-white transition hover:bg-coral-strong">
                <Plus size={12} /> 新建
              </button>
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {chat.sessions.filter((session) => !session.archived).length === 0 && (
                <p className="px-2 py-5 text-center text-xs text-faint">还没有会话，新建一个开始提问</p>
              )}
              {chat.sessions.filter((session) => !session.archived).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => void selectSession(session.id)}
                  className={cn(
                    'session-drawer-item flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                    session.id === chat.activeId
                      ? 'border-accent/30 bg-accent-soft text-accent'
                      : 'border-transparent hover:border-line hover:bg-elevated'
                  )}
                >
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', session.id === chat.activeId ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted')}>
                    <MessageSquarePlus size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs">{session.title}</strong>
                    <small className="mt-0.5 block truncate text-[10px] text-faint">{formatTime(session.updatedAt)} · {session.messageCount} 条消息{chat.runningSessionIds.includes(session.id) ? ' · 运行中' : ''}{chat.backgroundAttentionSessionIds.includes(session.id) ? ' · 待处理' : ''}</small>
                  </span>
                  {session.id === chat.activeId && <Check size={13} />}
                </button>
              ))}
            </div>
            <Link to="/chat" onClick={() => { setDetailsOpen(false); close() }} className="mt-2 flex h-8 items-center justify-center gap-1.5 rounded-lg text-[11px] text-muted transition hover:bg-elevated hover:text-fg">
              打开完整智能体工作台 <ExternalLink size={12} />
            </Link>
            {settings?.orchestrationDefaults?.enabled && <p className="mt-1 px-2 text-center text-[10px] leading-4 text-warning">小窗口默认使用一般模式；如需编排协作，请打开完整智能体工作台。</p>}
          </section>

          <div className="flex flex-wrap items-center gap-2 bg-app/50 px-3 py-3">
            {chat.attachments.length > 0 && (
              <div className="flex w-full flex-wrap gap-1.5">
                {chat.attachments.map((attachment) => (
                  <span key={`${attachment.kind}_${attachment.id}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-[11px] text-accent">
                    <FileText size={11} />
                    <span className="truncate">{attachment.label}</span>
                    <button type="button" className="cursor-pointer hover:opacity-70" onClick={() => chat.setAttachments(chat.attachments.filter((item) => item.id !== attachment.id))}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {providerOptions.length > 0 ? (
              <>
              <select
                value={modelValue}
                onChange={(event) => {
                  const [providerId, model] = event.target.value.split('::')
                  if (providerId && model) void useSettings.getState().update({ defaultChatModel: { providerId, model } })
                }}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-xs text-muted outline-none focus:border-accent"
                aria-label="选择模型"
              >
                {providerOptions.map((provider) => (
                  <optgroup key={provider.id} label={provider.name}>
                    {provider.models.map((model) => <option key={model} value={`${provider.id}::${model}`}>{model}</option>)}
                  </optgroup>
                ))}
              </select>
              <select
                value={agentMode}
                onChange={(event) => setAgentMode(event.target.value as AgentMode)}
                disabled={chat.streaming}
                className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-muted outline-none focus:border-accent disabled:opacity-60"
                aria-label="运行模式"
              >
                <option value="normal">一般模式</option>
                <option value="goal">目标模式（多步骤）</option>
              </select>
              <select
                value={chat.approvalPolicy}
                onChange={(event) => void chat.updateApprovalPolicy(event.target.value as ApprovalPolicy).catch((error) => useChat.setState({ error: error instanceof Error ? error.message : String(error) }))}
                disabled={approvalPolicyPickerDisabled({ activeId: chat.activeId, streaming: chat.streaming })}
                className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-muted outline-none focus:border-accent disabled:opacity-60"
                aria-label="写入审批策略"
              >
                <option value="strict">严格审批</option>
                <option value="delete-confirm">自动审批（删除确认）</option>
                <option value="auto">自动执行</option>
              </select>
              {agentMode === 'goal' && <span className="w-full text-[10px] text-warning">目标模式可能消耗更多额度</span>}
              </>
            ) : (
              <Link to="/settings" onClick={() => setDetailsOpen(false)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/30 bg-danger-soft px-2.5 text-xs text-danger">
                <Settings size={12} /> 配置模型
              </Link>
            )}
            {activeSession && <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-faint">{formatTime(activeSession.updatedAt)}</span>}
          </div>
        </div>
      )}

      <div data-chat-column className="flex min-h-0 flex-1 flex-col bg-app/70">
        <div data-chat-conversation ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          {chat.messages.length === 0 && !activeStreaming ? (
            <div data-chat-empty className="mx-auto flex max-w-md flex-col items-center px-2 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Bot size={24} />
              </span>
              <h2 className="mt-4 text-lg font-semibold">把你的问题放在故事旁边</h2>
              <p className="mt-2 text-xs leading-5 text-muted">智能体会按需查阅章节、前后文、人物、事件与设定，写回前仍由你确认。</p>
              <div data-chat-quick-actions className="mt-6 w-full space-y-2">
                {QUICK_QUESTIONS.map((question) => (
                  <button key={question} type="button" onClick={() => input.setText(question)} className="w-full cursor-pointer rounded-xl border border-line bg-panel px-4 py-3 text-left text-xs leading-5 text-muted transition hover:border-accent hover:text-fg">
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {chat.messages.map((message) => <SidebarMessage key={message.id} message={message} />)}
              {activeStreaming && <SkillActivity events={chat.liveSkillEvents} />}
              {activeStreaming && <RuleActivity events={chat.liveRuleEvents} />}
              {chat.liveTimeline.map((item) => item.kind === 'text'
                ? (
                    <div key={item.id} className="flex gap-3">
                      <SidebarAvatar assistant />
                      <div className="min-w-0 flex-1">
                        <div className="rounded-xl border border-line bg-panel px-3.5 py-3"><Markdown text={item.text} /></div>
                        {item.text && <div className="mt-1"><CopyButton text={item.text} label="复制AI回复" /></div>}
                      </div>
                    </div>
                  )
                : item.kind === 'stage' ? (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[11px] text-muted">
                      <span className={cn('h-2 w-2 rounded-full', item.status === 'running' ? 'animate-pulse bg-accent' : item.status === 'completed' ? 'bg-ok' : 'bg-danger')} />
                      <span>{isOrdinaryChapterAgentStage(item.stageId) ? '智能体' : '阶段'}：{agentStageLabel(item.stageId)}</span>
                    </div>
                  ) : (
                    <ToolRunRow
                      key={item.callId}
                      name={item.name}
                      argsJson={item.argsJson}
                      status={item.status}
                      preview={item.preview}
                      compact
                    />
                  ))}
              {activeStreaming && shouldShowThinking(chat.liveTimeline) && (
                <ThinkingRow label={agentThinkingLabel(activeLiveStage, defaultModel?.model ?? '模型')} />
              )}
              {chat.error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{chat.error}</div>}
            </div>
          )}
        </div>

        <div className="chat-composer chat-sidebar-composer shrink-0 border-t border-line p-3">
          {chat.messageFiles.length > 0 && (
            <div data-chat-attachments className="mb-2 flex flex-wrap gap-1.5">
              {chat.messageFiles.map((file) => (
                <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-elevated px-2 py-1 text-[10px] text-muted">
                  {file.kind === 'image' ? '图片' : '文件'} · <span className="max-w-40 truncate">{file.name}</span>
                  <button type="button" className="cursor-pointer hover:text-fg" onClick={() => chat.setMessageFiles(chat.messageFiles.filter((item) => item.id !== file.id))}><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="chat-composer-field relative rounded-xl border border-line bg-panel shadow-sm transition focus-within:border-accent">
            <textarea
              ref={composerRef}
              value={input.text}
              onChange={(event) => input.setText(event.target.value)}
              onKeyDown={(event) => {
                if (shouldSendOnKey(settings?.sendShortcut ?? 'enter', {
                  key: event.key,
                  shiftKey: event.shiftKey,
                  metaKey: event.metaKey,
                  ctrlKey: event.ctrlKey,
                  isComposing: event.nativeEvent.isComposing
                })) {
                  event.preventDefault()
                  void send()
                }
              }}
              rows={isAndroid ? 1 : 3}
              placeholder="随时问智能体…"
              className="chat-text-body w-full resize-none bg-transparent px-3.5 py-3 pr-14 outline-none placeholder:text-faint"
            />
            <div className="chat-sidebar-composer-attach absolute bottom-2 left-2">
              <AttachmentMenu
                open={attachOpen}
                onOpenChange={setAttachOpen}
                onFiles={async (files) => {
                  try {
                    const prepared = await prepareMessageFiles(files)
                    const next = [...chat.messageFiles]
                    for (const file of prepared) {
                      if (!next.some((item) => item.name === file.name && item.size === file.size && (item.kind === 'image' ? item.base64 : item.text) === (file.kind === 'image' ? file.base64 : file.text))) next.push(file)
                    }
                    chat.setMessageFiles(next)
                  } catch (error) {
                    useChat.setState({ error: error instanceof Error ? error.message : String(error) })
                  }
                }}
                onReference={() => {
                  setAttachOpen(false)
                  setReferenceOpen(true)
                }}
                onCompressContext={() => chat.compressContext().catch((error) => { useChat.setState({ error: error instanceof Error ? error.message : String(error) }) })}
                compressing={chat.contextCompressing || chat.streaming}
              />
            </div>
            <div className="chat-sidebar-composer-send absolute bottom-2 right-2 flex items-center gap-1">
              <ContextUsageMeter
                ringOnly
                usedTokens={contextUsage.usedTokens}
                contextTokens={contextUsage.inputBudgetTokens}
                contextWindowTokens={contextUsage.contextTokens}
                compressing={chat.contextCompressing}
                compressedMessages={chat.contextCompression?.summarizedMessages}
              />
              {activeStreaming ? (
                <Button variant="outline" size="sm" onClick={() => void chat.abort()} title="中止生成"><Square size={12} /></Button>
              ) : (
                <>
                  {backgroundStreaming && <Button variant="outline" size="sm" onClick={() => void selectSession(chat.runningSessionId!)} title="返回正在运行的会话"><History size={12} /></Button>}
                  <Button variant="primary" size="sm" onClick={() => void send()} title="发送当前会话消息" disabled={!input.text.trim() && !chat.messageFiles.length && !chat.attachments.length}><Send size={12} /></Button>
                </>
              )}
            </div>
            {referenceOpen && (
              <div ref={referencePanelRef} className="absolute bottom-14 left-2 z-40 w-[min(330px,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-2 shadow-2xl">
                <div className="mb-1.5 flex items-center gap-2">
                  <AtSign size={14} className="text-accent" />
                  <Input autoFocus value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="搜索人物、章节、事件或大纲…" className="h-8 text-xs" />
                  <button type="button" className="p-1 text-faint hover:text-fg" onClick={() => setReferenceOpen(false)}><X size={13} /></button>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {references.length === 0 && <p className="px-2 py-4 text-center text-xs text-faint">没有匹配资料</p>}
                  {references.map((reference) => {
                    const added = chat.attachments.some((item) => item.id === reference.id)
                    return (
                      <button
                        key={`${reference.kind}_${reference.id}`}
                        type="button"
                        onClick={() => {
                          if (added) chat.setAttachments(chat.attachments.filter((item) => item.id !== reference.id))
                          else chat.setAttachments([...chat.attachments, reference])
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated"
                      >
                        <FileText size={13} className="text-faint" />
                        <span className="min-w-0 flex-1 truncate">{reference.label}</span>
                        {added && <Check size={12} className="text-accent" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {chat.pendingChange && <PendingChangeDialog change={chat.pendingChange} onConfirm={(approved) => void chat.confirmChange(approved)} />}
      </aside>
    </div>
  )
}

function SidebarAvatar({ assistant }: { assistant?: boolean }): React.ReactElement {
  return (
    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', assistant ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted')}>
      {assistant ? <Bot size={14} /> : <UserRound size={13} />}
    </span>
  )
}

function SidebarMessage({ message }: { message: ChatMessage }): React.ReactElement {
  if (message.role === 'tool') {
    return (
      <ToolRunRow
        name={message.toolName ?? 'tool'}
        status={message.isError ? 'error' : 'ok'}
        resultText={message.text}
        compact
      />
    )
  }
  if (!message.text && message.toolCalls?.length) return <></>
  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="min-w-0 max-w-[86%]">
          <div data-native-text-selection="true" className="chat-text-body chat-selectable-text chat-user-message-text whitespace-pre-wrap break-words rounded-xl bg-accent px-3.5 py-2.5 leading-relaxed text-accent-fg">{message.text}</div>
          {message.text && <div className="mt-1 text-right"><CopyButton text={message.text} label="复制用户消息" /></div>}
        </div>
        <SidebarAvatar />
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <SidebarAvatar assistant />
      <div className="min-w-0 flex-1">
        {message.agentIdentity && <div className="mb-1 text-[10px] font-medium text-accent">{message.agentIdentity.label} · {message.agentIdentity.model}</div>}
        <div className={cn('rounded-xl border border-line bg-panel px-3.5 py-3', message.isError && 'border-danger/40')}>
          {message.text && <Markdown text={message.text} />}
          {message.files && <SidebarFiles files={message.files} />}
        </div>
        {message.text && <div className="mt-1"><CopyButton text={message.text} label="复制AI回复" /></div>}
        <RunActivityDetails activity={message.runActivity} />
      </div>
    </div>
  )
}

function SidebarFiles({ files }: { files: MessageFile[] }): React.ReactElement {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {files.map((file) => (
        <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-elevated px-2 py-1 text-[10px] text-muted">
          <FileText size={10} /> <span className="max-w-40 truncate">{file.name}</span> <Check size={10} className="text-ok" />
        </span>
      ))}
    </div>
  )
}
