import {
  Archive,
  ArchiveRestore,
  AtSign,
  BookOpen,
  Bot,
  Download,
  FileText,
  History,
  ListTree,
  MessageSquarePlus,
  Network,
  PanelLeftOpen,
  Pencil,
  Send,
  Square,
  Trash2,
  Upload,
  UserRound,
  Waypoints,
  X
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMode, ApprovalPolicy, Attachment, ChatDensity, ChatMessage, MessageFile, ReasoningPreference, RunAgentRequest, SessionMeta } from '../../../../shared/types'
import { Markdown } from '../../components/markdown/Markdown'
import { PendingChangeDialog } from '../../components/chat/PendingChangeDialog'
import { AgentQuestionDialog } from '../../components/chat/AgentQuestionDialog'
import { SkillCandidateDialog } from '../../components/chat/SkillCandidateDialog'
import { ContextUsageMeter, shouldShowThinking, ThinkingRow, ToolRunRow } from '../../components/chat/AgentActivity'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { CopyButton } from '../../components/ui/CopyButton'
import { chatDensityClasses } from '../../lib/chatDensity'
import { resolveCapability, resolveContextWindow } from '../../lib/modelCapability'
import { shouldSendOnKey } from '../../lib/sendShortcut'
import { cn, ENTITY_KIND_LABEL, formatTime } from '../../lib/utils'
import { useChat } from '../../stores/chatStore'
import { useSettings } from '../../stores/settingsStore'
import { useWorkspace } from '../../stores/workspaceStore'
import { bytesToBase64 } from '../../platform/archiveTransfer'
import { getPlatformApi } from '../../platform/platformApi'
import { prepareMessageFiles } from '../../lib/prepareMessageFiles'
import { AttachmentMenu } from '../../components/chat/AttachmentMenu'
import { WebSearchModeMenu } from '../../components/chat/WebSearchModeMenu'
import { estimateTextTokens, resolveContextUsage } from '../../../../core/agent/contextWindow'
import { SYSTEM_PROMPT } from '../../../../core/agent/prompts'
import { chatDraftScope, useChatDraft } from '../../stores/chatDraftStore'
import { OrchestrationResults } from '../../components/chat/OrchestrationResults'
import { OrchestrationPanel } from '../../components/chat/OrchestrationPanel'
import { ChatWorkbenchIdentity } from '../../components/chat/ChatWorkbenchIdentity'
import { workbenchColumnsClass, workbenchShellClass, workbenchTopbarClass } from '../../lib/layoutPresentation'
import { normalizeOrchestrationPreferences } from '../../../../shared/creative'
import { creativePreferencesForMode } from '../../lib/creativePreferences'
import { agentStageLabel, agentThinkingLabel, isOrdinaryChapterAgentStage } from '../../lib/agentStagePresentation'
import { approvalPolicyPickerDisabled } from '../../stores/chatScope'
import { parseProseAlternatives } from '../../lib/proseAlternatives'
import { SkillActivity } from '../../components/chat/SkillActivity'
import { RuleActivity } from '../../components/chat/RuleActivity'
import { RunActivityDetails } from '../../components/chat/RunActivityDetails'
import { useChatInputAutosize } from '../../components/chat/useChatInputAutosize'

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
  ,projectDoc: <FileText size={12} />
}

export function ChatPage(): React.ReactElement {
  const chat = useChat()
  const summary = useWorkspace((s) => s.summary)
  const uiSource = useWorkspace((s) => s.uiSource)
  const settings = useSettings((s) => s.settings)
  const [attachOpen, setAttachOpen] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [tab, setTab] = useState<'recent' | 'archived'>('recent')
  const [sessionListOpen, setSessionListOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sessionImportRef = useRef<HTMLInputElement | null>(null)
  const isAndroid = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())

  useEffect(() => {
    if (!isAndroid) return
    const closeOnLandscape = (): void => {
      if (window.matchMedia('(orientation: landscape)').matches) setSessionListOpen(false)
    }
    window.addEventListener('resize', closeOnLandscape)
    window.addEventListener('orientationchange', closeOnLandscape)
    return () => {
      window.removeEventListener('resize', closeOnLandscape)
      window.removeEventListener('orientationchange', closeOnLandscape)
    }
  }, [isAndroid])
  const [sessionTransferBusy, setSessionTransferBusy] = useState(false)
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false)
  const [skillCandidateDialogOpen, setSkillCandidateDialogOpen] = useState(false)
  const latestQuestionId = useRef<string | null>(null)
  const latestCandidateId = useRef<string | null>(null)
  const [agentMode, setAgentMode] = useState<AgentMode>('normal')
  const [webSearchMode, setWebSearchMode] = useState<NonNullable<RunAgentRequest['webSearchMode']>>('off')
  const [modeSwitching, setModeSwitching] = useState(false)
  const modeSwitchingRef = useRef(false)
  const draftScope = chatDraftScope({ source: uiSource ?? 'electron-local', path: summary?.path ?? '' }, chat.activeId)
  const input = useChatDraft(draftScope)
  const composerRef = useChatInputAutosize(input.text, isAndroid, settings?.chatFontSize)

  const providerOptions = useMemo(() => (settings?.providers ?? []).filter((p) => p.models.length > 0), [settings])
  const defaultModel = settings?.defaultChatModel
  const density = settings?.chatDensity ?? 'comfortable'
  const densityClasses = chatDensityClasses(density)
  const selectedProvider = providerOptions.find((provider) => provider.id === defaultModel?.providerId)
  const selectedModelSettings = selectedProvider && defaultModel ? selectedProvider.modelSettings?.[defaultModel.model] : undefined
  const selectedCapability = defaultModel ? resolveCapability(defaultModel.model, selectedModelSettings) : { reasoning: false, vision: false }
  const contextWindow = resolveContextWindow(defaultModel?.model ?? '', selectedModelSettings)
  const selectedReasoning: ReasoningPreference = defaultModel
    ? chat.modelPreferences.find((item) => item.providerId === defaultModel.providerId && item.model === defaultModel.model)?.reasoning ?? 'inherit'
    : 'inherit'
  const orchestrationEnabled = chat.creativePreferences?.orchestrationEnabled === true
  useEffect(() => {
    setAgentMode(orchestrationEnabled ? 'orchestration' : 'normal')
  }, [orchestrationEnabled, chat.activeId])
  const orchestrationProfile = useMemo(() => normalizeOrchestrationPreferences(chat.creativePreferences?.orchestration), [chat.creativePreferences])
  const latestOrchestrationRun = chat.orchestrationRuns.at(-1)
  const activeStreaming = Boolean(chat.activeId && chat.runningSessionIds.includes(chat.activeId)) || (chat.streaming && (!chat.runningSessionId || chat.runningSessionId === chat.activeId))
  const backgroundStreaming = chat.runningSessionIds.some((id) => id !== chat.activeId) || (chat.streaming && !!chat.runningSessionId && chat.runningSessionId !== chat.activeId)
  const activeLiveStage = [...chat.liveTimeline].reverse().find((item): item is Extract<typeof item, { kind: 'stage' }> => item.kind === 'stage' && item.status === 'running')?.stageId
  const liveOrchestrationStages = useMemo(
    () => chat.liveTimeline
      .filter((item): item is Extract<typeof item, { kind: 'stage' }> => item.kind === 'stage')
      .map((item) => ({ stageId: item.stageId, status: item.status })),
    [chat.liveTimeline]
  )

  useEffect(() => {
    const id = chat.pendingQuestion?.questionId ?? null
    if (id && id !== latestQuestionId.current) {
      latestQuestionId.current = id
      setQuestionDialogOpen(true)
    }
    if (!id) {
      latestQuestionId.current = null
      setQuestionDialogOpen(false)
    }
  }, [chat.pendingQuestion?.questionId])

  useEffect(() => {
    const id = chat.pendingSkillCandidate?.candidateId ?? null
    if (id && id !== latestCandidateId.current) {
      latestCandidateId.current = id
      setSkillCandidateDialogOpen(true)
    }
    if (!id) {
      latestCandidateId.current = null
      setSkillCandidateDialogOpen(false)
    }
  }, [chat.pendingSkillCandidate?.candidateId])

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
  }, [chat.messages.length, chat.liveTimeline.length])

  const visibleSessions = useMemo(
    () => chat.sessions.filter((s) => (tab === 'archived' ? s.archived : !s.archived)),
    [chat.sessions, tab]
  )
  const archivedCount = useMemo(() => chat.sessions.filter((s) => s.archived).length, [chat.sessions])

  const send = async (): Promise<void> => {
    const text = input.text
    if ((!text && !chat.messageFiles.length && !chat.attachments.length) || (chat.activeId && chat.runningSessionIds.includes(chat.activeId)) || modeSwitchingRef.current) return
    if (!defaultModel) {
      useChat.setState({ error: '请先在“设置”中配置供应商、API Key 和默认模型' })
      return
    }
    await chat.send(text, {
      providerId: defaultModel.providerId,
      model: defaultModel.model,
      webSearchMode,
      reasoning: selectedReasoning === 'inherit' ? undefined : selectedReasoning,
      mode: orchestrationEnabled ? 'orchestration' : agentMode,
      creative: chat.creativePreferences
    })
  }

  const resumeOrchestration = async (): Promise<void> => {
    const run = chat.orchestrationRuns.at(-1)
    if (!run || chat.streaming || !defaultModel) return
    await chat.send('继续当前编排 checkpoint', {
      providerId: defaultModel.providerId,
      model: defaultModel.model,
      webSearchMode,
      reasoning: selectedReasoning === 'inherit' ? undefined : selectedReasoning,
      mode: 'orchestration',
      resumeOrchestrationRunId: run.runId,
      creative: chat.creativePreferences
    })
  }

  const setCreativeMode = async (enabled: boolean): Promise<void> => {
    if (chat.streaming || modeSwitchingRef.current) return
    modeSwitchingRef.current = true
    setModeSwitching(true)
    try {
      await chat.updateCreativePreferences(creativePreferencesForMode(chat.creativePreferences, settings ?? undefined, enabled))
      setAgentMode(enabled ? 'orchestration' : 'normal')
    } catch (error) {
      useChat.setState({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      modeSwitchingRef.current = false
      setModeSwitching(false)
    }
  }

  const startRename = (s: SessionMeta): void => {
    setRenamingId(s.id)
    setRenameText(s.title)
  }
  const commitRename = async (): Promise<void> => {
    if (renamingId) await chat.renameSession(renamingId, renameText)
    setRenamingId(null)
  }

  const exportActiveSession = async (): Promise<void> => {
    if (!chat.activeId) return
    setSessionTransferBusy(true)
    try {
      const archive = await getPlatformApi().exportSession(chat.activeId)
      const platform = getPlatformApi()
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && platform.shareSessionArchive) {
        await platform.shareSessionArchive(archive)
      } else {
        const a = document.createElement('a')
        a.href = `data:application/json;base64,${archive.base64}`
        a.download = archive.fileName
        a.click()
      }
    } catch (err) {
      useChat.setState({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setSessionTransferBusy(false)
    }
  }

  const importSession = async (file: File): Promise<void> => {
    setSessionTransferBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await getPlatformApi().importSession(bytesToBase64(bytes), file.name)
      await chat.initSessions()
    } catch (err) {
      useChat.setState({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setSessionTransferBusy(false)
      if (sessionImportRef.current) sessionImportRef.current.value = ''
    }
  }

  /* 会话长度估算：所有消息文本字符数 */
  const totalChars = useMemo(() => chat.messages.reduce((n, m) => n + (m.text?.length ?? 0), 0), [chat.messages])
  const contextUsage = useMemo(() => resolveContextUsage({
    messages: chat.messages,
    contextTokens: contextWindow.contextTokens,
    maxOutputTokens: contextWindow.maxOutputTokens,
    summaryThrough: chat.contextSummaryThrough,
    summaryTokens: estimateTextTokens(chat.contextSummary),
    systemTokens: estimateTextTokens(SYSTEM_PROMPT)
  }), [chat.messages, chat.contextSummary, chat.contextSummaryThrough, contextWindow.contextTokens, contextWindow.maxOutputTokens])

  if (!summary) return <div />

  return (
    <div className={cn(workbenchShellClass(), 'chat-surface')}>
      <div data-chat-topbar className={workbenchTopbarClass()}>
        <button data-android-session-trigger type="button" className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2 text-xs text-muted lg:hidden" aria-label="打开会话列表" onClick={() => setSessionListOpen(true)}><PanelLeftOpen size={15} />会话</button>
        <ChatWorkbenchIdentity showSessionLength={Boolean(settings?.showSessionLength)} messageCount={chat.messages.length} totalChars={totalChars} />
        <span className="chat-text-meta hidden truncate text-faint xl:inline">资料不进提示词 · 需要时自动查阅</span>
        <select
          value={orchestrationEnabled ? 'orchestration' : 'basic'}
          onChange={(event) => void setCreativeMode(event.target.value === 'orchestration')}
          disabled={chat.streaming || modeSwitching || !chat.activeId}
          aria-label="会话创作模式"
          className="chat-text-meta h-8 shrink-0 rounded-lg border border-line bg-panel px-2 text-muted outline-none focus:border-accent disabled:opacity-60"
        >
          <option value="basic">普通模式</option>
          <option value="orchestration">编排模式</option>
        </select>
        {orchestrationEnabled
          ? <div className="ml-auto min-w-0 w-full sm:w-auto sm:max-w-[min(100%,54rem)]">
              <OrchestrationPanel profile={orchestrationProfile} defaultModel={defaultModel} compact running={activeStreaming} budget={chat.budget} run={latestOrchestrationRun} liveStages={liveOrchestrationStages} approvalPolicy={chat.approvalPolicy} onResume={() => void resumeOrchestration()} />
            </div>
          : providerOptions.length === 0 && <Badge tone="danger">尚未配置供应商，请前往设置</Badge>}
      </div>
      <div className={workbenchColumnsClass()}>
      {/* 会话列表 */}
      {sessionListOpen && <button data-android-session-backdrop type="button" className="fixed inset-0 z-30 bg-[#071024]/50 lg:hidden" aria-label="关闭会话列表" onClick={() => setSessionListOpen(false)} />}
      <aside data-android-session-list data-open={sessionListOpen} className={cn('chat-session-drawer shrink-0 flex-col border-r border-line bg-[#f1efe9] lg:relative lg:flex lg:h-auto lg:w-60', sessionListOpen ? 'fixed inset-y-0 left-0 z-40 flex w-[min(84vw,20rem)] shadow-2xl' : 'hidden')}>
        <div className="p-3 pb-2">
          <div data-android-session-actions className="flex gap-2">
                <Button size="sm" variant="outline" className="min-w-0 flex-1 justify-center" onClick={() => { setSessionListOpen(false); void chat.newSession() }} disabled={sessionTransferBusy}>
            <MessageSquarePlus size={14} /> 新会话
            </Button>
            <Button size="sm" variant="ghost" className="shrink-0" title="导入会话" onClick={() => sessionImportRef.current?.click()} disabled={sessionTransferBusy}>
              <Upload size={14} />
            </Button>
            <Button size="sm" variant="ghost" className="shrink-0" title="导出当前会话" onClick={() => void exportActiveSession()} disabled={sessionTransferBusy || !chat.activeId}>
              <Download size={14} />
            </Button>
            <input ref={sessionImportRef} type="file" accept=".json,.session.json,application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importSession(file) }} />
          </div>
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
              data-android-session-row
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
                <button onClick={() => { setSessionListOpen(false); void chat.openSession(s.id) }} onDoubleClick={() => startRename(s)} className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left">
                  <div className={cn('truncate text-xs font-medium', chat.activeId === s.id ? 'text-accent' : 'text-fg')}>{s.title}</div>
                  <div className="text-[10px] text-faint">
                    {formatTime(s.updatedAt)} · {s.messageCount} 条{chat.runningSessionIds.includes(s.id) ? ' · 运行中' : ''}{chat.backgroundAttentionSessionIds.includes(s.id) ? ' · 待处理' : ''}
                  </div>
                </button>
              )}
              <div data-android-session-row-actions className="mr-1 flex shrink-0 gap-0.5 lg:hidden lg:group-hover:flex">
                {chat.runningSessionIds.includes(s.id) && (
                  <button
                    onClick={() => void chat.stopSession(s.id).catch((error) => useChat.setState({ error: error instanceof Error ? error.message : String(error) }))}
                    title="先停止运行，再删除会话"
                    className="rounded p-1 text-faint hover:text-accent cursor-pointer"
                  >
                    <Square size={11} />
                  </button>
                )}
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
                  title={chat.runningSessionIds.includes(s.id) ? '请先停止运行，再删除会话' : '删除会话'}
                  disabled={chat.runningSessionIds.includes(s.id)}
                  className="rounded p-1 text-faint hover:text-danger cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 对话区 */}
      <div data-chat-column className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 消息列表 */}
        <div data-chat-conversation ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-app/70 px-3 py-4 sm:px-6 sm:py-6">
          {chat.messages.length === 0 && !activeStreaming && (
            <div data-chat-empty className="mx-auto max-w-xl">
              <EmptyState
                icon={<Bot size={36} />}
                title="让智能体成为你的创作搭档"
                hint="它会在需要时自行查阅人物卡、关系、大纲、事件与正文；修改项目资料前都会先请你确认。"
              />
              <div data-chat-quick-actions className="mt-4 space-y-2">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => input.setText(q)}
                    className="chat-text-body w-full cursor-pointer rounded-lg border border-line bg-panel px-4 py-2.5 text-left text-muted transition hover:border-accent hover:text-fg"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={cn('mx-auto w-full max-w-6xl', densityClasses.list)}>
            <OrchestrationResults runs={chat.orchestrationRuns ?? []} />
            {activeStreaming && <SkillActivity events={chat.liveSkillEvents} />}
            {activeStreaming && <RuleActivity events={chat.liveRuleEvents} />}
            {chat.messages.map((m) => (
              <MessageItem key={m.id} msg={m} density={density} alternativesEnabled={settings?.agentGeneration.proseAlternativesEnabled === true} onChooseAlternative={(content) => input.setText(`请采用以下正文方案继续处理：\n\n${content}`)} />
            ))}

            {chat.liveTimeline.map((item) => item.kind === 'text'
              ? (
                  <div key={item.id} className="flex gap-3">
                    <Avatar icon={<Bot size={15} />} accent />
                    <div className="min-w-0 flex-1">
                      <div className={cn('rounded-xl border border-line bg-panel', densityClasses.assistantBubble)}>
                        <Markdown text={item.text} />
                      </div>
                      {item.text && <div className="mt-1"><CopyButton text={item.text} label="复制AI回复" /></div>}
                    </div>
                  </div>
                )
              : item.kind === 'stage' ? (
                  <div key={item.id} className="chat-text-meta flex min-w-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-muted">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', item.status === 'running' ? 'animate-pulse bg-accent' : item.status === 'completed' ? 'bg-ok' : 'bg-danger')} />
                    <span className="min-w-0 flex-1 truncate">{isOrdinaryChapterAgentStage(item.stageId) ? '智能体' : '阶段'}：{agentStageLabel(item.stageId)}</span>
                    <span className="chat-text-micro ml-auto shrink-0 whitespace-nowrap text-faint">{item.status === 'running' ? '进行中' : item.status === 'completed' ? '已完成' : '失败'}</span>
                  </div>
                ) : (
                  <ToolRunRow
                    key={item.callId}
                    name={item.name}
                    argsJson={item.argsJson}
                    status={item.status}
                    preview={item.preview}
                  />
                ))}

            {activeStreaming && shouldShowThinking(chat.liveTimeline) && (
              <ThinkingRow label={agentThinkingLabel(activeLiveStage, defaultModel?.model ?? '模型')} />
            )}

            {chat.error && <div className="chat-text-meta rounded-lg bg-danger-soft px-4 py-2.5 text-danger">{chat.error}</div>}
          </div>
        </div>

        {/* 输入区 */}
        <div className="chat-composer shrink-0 border-t border-line bg-panel/[0.94] px-3 py-3 backdrop-blur-xl sm:p-4">
          <div className="relative mx-auto w-full max-w-6xl">
            {chat.attachments.length > 0 && (
              <div data-chat-attachments className="mb-2 flex flex-wrap gap-1.5">
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
            {chat.messageFiles.length > 0 && (
              <div data-chat-attachments className="mb-2 flex flex-wrap gap-1.5">
                {chat.messageFiles.map((file) => (
                  <FileChip key={file.id} file={file} onRemove={() => chat.setMessageFiles(chat.messageFiles.filter((item) => item.id !== file.id))} />
                ))}
              </div>
            )}
            <div className="relative rounded-xl border border-line bg-panel focus-within:border-accent transition">
              {((chat.pendingQuestion && !questionDialogOpen) || (chat.pendingSkillCandidate && !skillCandidateDialogOpen)) && (
                <div className="flex items-center justify-between gap-2 border-b border-line/70 bg-gold-soft px-3 py-2 text-xs text-gold">
                  <span>{chat.pendingQuestion ? '智能体正在等待你的回答' : '智能体正在等待 Skill 候选决定'}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => chat.pendingQuestion ? setQuestionDialogOpen(true) : setSkillCandidateDialogOpen(true)}
                  >
                    继续处理
                  </Button>
                </div>
              )}
              <textarea
                ref={composerRef}
                value={input.text}
                onChange={(e) => input.setText(e.target.value)}
                onKeyDown={(e) => {
                  if (shouldSendOnKey(settings?.sendShortcut ?? 'enter', {
                    key: e.key,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                    isComposing: e.nativeEvent.isComposing
                  })) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={isAndroid ? 1 : 2}
                placeholder={
                  (settings?.sendShortcut ?? 'enter') === 'mod+enter'
                    ? '和智能体聊聊你的故事……（Ctrl/⌘+Enter 发送 / Enter 换行）'
                    : '和智能体聊聊你的故事……（Enter 发送 / Shift+Enter 换行）'
                }
                className="chat-text-body min-h-[4.5rem] w-full resize-none rounded-xl bg-transparent px-4 py-3 leading-6 outline-none placeholder:text-faint"
              />
              <div data-chat-toolbar className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-2 py-2">
                <div data-chat-toolbar-group className="flex min-w-0 items-center gap-1">
                <div data-chat-tool="attachments">
                <AttachmentMenu
                  open={attachOpen}
                  onOpenChange={setAttachOpen}
                  agentMode={agentMode}
                  onAgentModeChange={setAgentMode}
                  onFiles={async (files) => {
                    try {
                      const prepared = await prepareMessageFiles(files)
                      const existing = chat.messageFiles
                      const next = [...existing]
                      for (const file of prepared) {
                        if (!next.some((item) => item.name === file.name && item.size === file.size && (item.kind === 'image' ? item.base64 : item.text) === (file.kind === 'image' ? file.base64 : file.text))) next.push(file)
                      }
                      chat.setMessageFiles(next)
                    } catch (error) {
                      useChat.setState({ error: error instanceof Error ? error.message : String(error) })
                    }
                  }}
                  onReference={() => { setAttachOpen(false); setReferenceOpen(true) }}
                  onCompressContext={() => chat.compressContext().catch((error) => { useChat.setState({ error: error instanceof Error ? error.message : String(error) }) })}
                  compressing={chat.contextCompressing || chat.streaming}
                />
                </div>
                <select
                  data-chat-tool="approval"
                  value={chat.approvalPolicy}
                  onChange={(e) => void chat.updateApprovalPolicy(e.target.value as ApprovalPolicy).catch((error) => useChat.setState({ error: error instanceof Error ? error.message : String(error) }))}
                  disabled={approvalPolicyPickerDisabled({ activeId: chat.activeId, streaming: chat.streaming })}
                  title="当前会话的写入审批策略"
                  aria-label="写入审批策略"
                  className="h-8 min-w-0 max-w-36 rounded-lg border border-line bg-panel px-2 text-xs outline-none focus:border-accent cursor-pointer disabled:opacity-60"
                >
                  <option value="strict">严格审批</option>
                  <option value="delete-confirm">自动审批（删除确认）</option>
                  <option value="auto">自动执行</option>
                </select>
                <div data-chat-tool="search"><WebSearchModeMenu mode={webSearchMode} onChange={setWebSearchMode} disabled={chat.streaming} /></div>
                </div>
                <div data-chat-toolbar-group className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                {providerOptions.length > 0 && (
                  <select
                    data-chat-tool="model"
                    value={defaultModel ? `${defaultModel.providerId}::${defaultModel.model}` : ''}
                    onChange={(e) => {
                      const [providerId, model] = e.target.value.split('::')
                      if (providerId && model) void useSettings.getState().update({ defaultChatModel: { providerId, model } })
                    }}
                    title="对话模型"
                    aria-label="对话模型"
                    className="h-8 min-w-0 max-w-56 rounded-lg border border-line bg-panel px-2 text-xs outline-none focus:border-accent cursor-pointer"
                  >
                    {providerOptions.map((p) => (
                      <optgroup key={p.id} label={p.name}>
                        {p.models.map((m) => {
                          const capability = resolveCapability(m, p.modelSettings?.[m])
                          const suffix = [capability.reasoning ? '思考' : '', capability.vision ? '图片' : ''].filter(Boolean).join(' · ')
                          return <option key={m} value={`${p.id}::${m}`}>{m}{suffix ? ` · ${suffix}` : ''}</option>
                        })}
                      </optgroup>
                    ))}
                  </select>
                )}
                {providerOptions.length > 0 && (
                  <select
                    data-chat-tool="reasoning"
                    value={selectedReasoning}
                    disabled={chat.streaming || !chat.activeId || !selectedCapability.reasoning}
                    onChange={(e) => {
                      if (!defaultModel) return
                      const reasoning = e.target.value as ReasoningPreference
                      void chat.updateModelPreference({ providerId: defaultModel.providerId, model: defaultModel.model, reasoning }).catch((error) => {
                        useChat.setState({ error: error instanceof Error ? error.message : String(error) })
                      })
                    }}
                    title={selectedCapability.reasoning ? '本会话思考等级' : '当前模型不支持思考等级'}
                    aria-label="思考等级"
                    className="h-8 max-w-32 rounded-lg border border-line bg-panel px-2 text-xs outline-none focus:border-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="inherit">思考：跟随模型</option>
                    <option value="off">思考：不指定</option>
                    <option value="low">思考：低</option>
                    <option value="medium">思考：中</option>
                    <option value="high">思考：高</option>
                  </select>
                )}
                <div data-chat-tool="reference"><AttachPicker open={referenceOpen} onOpenChange={setReferenceOpen} /></div>
                <div data-chat-tool="usage">
                <ContextUsageMeter
                  ringOnly
                usedTokens={contextUsage.usedTokens}
                contextTokens={contextUsage.inputBudgetTokens}
                contextWindowTokens={contextUsage.contextTokens}
                  compressing={chat.contextCompressing}
                  compressedMessages={chat.contextCompression?.summarizedMessages}
                />
                </div>
                <div data-chat-tool="send" className="flex items-center gap-1">
                {activeStreaming ? (
                  <Button variant="outline" size="sm" onClick={() => void chat.abort()} title="中止生成">
                    <Square size={13} /> 停止
                  </Button>
                ) : (
                  <>
                    {backgroundStreaming && (
                      <Button variant="outline" size="sm" onClick={() => void chat.openSession(chat.runningSessionId!)} title="返回正在运行的会话">
                        <History size={13} /><span className="chat-return-label">返回运行会话</span>
                      </Button>
                    )}
                    <Button variant="primary" size="sm" onClick={() => void send()} disabled={modeSwitching || (!input.text.trim() && !chat.messageFiles.length && !chat.attachments.length)}>
                      <Send size={13} /> 发送
                    </Button>
                  </>
                )}
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      </div>
      {/* 写确认 */}
      {chat.pendingChange && <PendingChangeDialog change={chat.pendingChange} onConfirm={(ok) => void chat.confirmChange(ok)} />}
      <AgentQuestionDialog
        question={chat.pendingQuestion}
        open={questionDialogOpen}
        onClose={() => setQuestionDialogOpen(false)}
        onSubmit={async (answer) => { await chat.answerQuestion(answer); setQuestionDialogOpen(false) }}
      />
      <SkillCandidateDialog
        candidate={chat.pendingSkillCandidate}
        open={skillCandidateDialogOpen}
        onClose={() => setSkillCandidateDialogOpen(false)}
        onResolve={async (action) => { await chat.resolveSkillCandidate(chat.pendingSkillCandidate?.candidateId ?? '', action); setSkillCandidateDialogOpen(false) }}
      />
    </div>
  )
}

function FileChip({ file, onRemove }: { file: MessageFile; onRemove: () => void }): React.ReactElement {
  return <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-[11px] text-accent">{file.kind === 'image' ? '图片' : '文件'} · <span className="max-w-48 truncate">{file.name}</span><button className="cursor-pointer hover:opacity-70" onClick={onRemove} title="移除附件"><X size={11} /></button></span>
}

function Avatar({ icon, accent }: { icon: React.ReactElement; accent?: boolean }): React.ReactElement {
  return (
    <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', accent ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted')}>
      {icon}
    </div>
  )
}

function MessageItemInner({ msg, density, alternativesEnabled, onChooseAlternative }: { msg: ChatMessage; density: ChatDensity; alternativesEnabled?: boolean; onChooseAlternative?: (content: string) => void }): React.ReactElement {
  const cls = chatDensityClasses(density)
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end gap-3">
        <div className="min-w-0 max-w-[85%]">
          <div data-native-text-selection="true" className={cn('chat-text-body chat-selectable-text chat-user-message-text whitespace-pre-wrap break-words rounded-xl bg-accent text-accent-fg', cls.userBubble)}>
            {msg.text && <div>{msg.text}</div>}
            {msg.files && <MessageFiles files={msg.files} compact />}
          </div>
          {msg.text && <div className="mt-1 text-right"><CopyButton text={msg.text} label="复制用户消息" /></div>}
        </div>
        <Avatar icon={<UserRound size={14} />} />
      </div>
    )
  }
  if (msg.role === 'tool') {
    return (
      <ToolRunRow
        name={msg.toolName ?? 'tool'}
        status={msg.isError ? 'error' : 'ok'}
        resultText={msg.text}
      />
    )
  }
  if (!msg.text && msg.toolCalls?.length) return <></>
  return (
    <div className="flex gap-3">
      <Avatar icon={<Bot size={15} />} accent />
      <div className="min-w-0 flex-1">
        {msg.agentIdentity && <div className="mb-1 text-[10px] font-medium text-accent">{msg.agentIdentity.label} · {msg.agentIdentity.model}</div>}
        <div className={cn('chat-text-body rounded-xl border border-line bg-panel', cls.assistantBubble, msg.isError && 'border-danger/40')}>
          {msg.text && <Markdown text={msg.text} />}
          {msg.files && <MessageFiles files={msg.files} />}
        </div>
        {msg.text && <div className="mt-1"><CopyButton text={msg.text} label="复制AI回复" /></div>}
        <RunActivityDetails activity={msg.runActivity} />
        {alternativesEnabled && msg.text && <AlternativePicker text={msg.text} onChoose={onChooseAlternative} />}
      </div>
    </div>
  )
}

function MessageFiles({ files, compact = false }: { files: MessageFile[]; compact?: boolean }): React.ReactElement {
  return <div className={cn('mt-2 flex flex-wrap gap-1.5', compact && 'text-accent-fg/90')}>
    {files.map((file) => file.kind === 'image'
      ? <a key={file.id} href={`data:${file.mimeType};base64,${file.base64}`} target="_blank" rel="noreferrer" title={`打开图片：${file.name}`} className="block max-w-56 overflow-hidden rounded-lg border border-current/20"><img src={`data:${file.mimeType};base64,${file.base64}`} alt={file.name} className="max-h-40 max-w-full object-contain" /></a>
      : <a key={file.id} href={`data:${file.mimeType};charset=utf-8,${encodeURIComponent(file.text)}`} download={file.name} className="inline-flex max-w-56 items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-black/5" title={`下载文件：${file.name}`}><FileText size={12} /><span className="truncate">{file.name}</span><Download size={11} /></a>)}
  </div>
}

/** 历史消息在流式期间引用不变，memo 可避免每个 token 都重渲染并重新解析 Markdown。 */
const MessageItem = memo(MessageItemInner)

function AlternativePicker({ text, onChoose }: { text: string; onChoose?: (content: string) => void }): React.ReactElement | null {
  const alternatives = parseProseAlternatives(text)
  if (alternatives.length < 2) return null
  return (
    <div className="mt-2 rounded-lg border border-accent/30 bg-accent-soft/40 p-2">
      <div className="mb-1.5 text-[11px] font-medium text-accent">正文候选方案</div>
      <div className="flex flex-wrap gap-1.5">
        {alternatives.map((item) => (
          <Button key={item.id} size="sm" variant="outline" onClick={() => onChoose?.(item.content)} title={`将${item.title}回填到输入框`}>
            {item.title}
          </Button>
        ))}
      </div>
      <div className="mt-1.5 text-[11px] text-muted">选择后会回填到输入框，确认内容后再发送或写入章节。</div>
    </div>
  )
}

/** @引用选择器：从当前工作区实体中挑选并附加到消息 */
function AttachPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const attachments = useChat((s) => s.attachments)
  const setAttachments = useChat((s) => s.setAttachments)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

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
    <div ref={rootRef} className="relative">
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
                    onOpenChange(false)
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
    </div>
  )
}
