import { ArchiveRestore, BookOpen, Check, Copy, Download, FileImage, FolderPlus, Menu, Plus, Redo2, Save, Search, Sparkles, TextSelect, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/editor/MarkdownEditor'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { createAutosave } from '../../lib/autosave'
import { copyPlainText } from '../../lib/clipboard'
import { canSwitchDocument } from '../../lib/documentSwitch'
import { chapterTextAgentEnabled, chapterTextAgentPurpose, chapterTextAgentTask, type ChapterTextAgent } from '../../lib/chapterTextAgent'
import { creativePreferencesForMode } from '../../lib/creativePreferences'
import { usePersistentScrollPosition } from '../../lib/persistentScroll'
import { chapterReadingStorageKey, readChapterReadingState, resolveChapterTarget, writeChapterReadingState, type ChapterReadingState } from '../../lib/chapterReadingState'
import { imageFileStem, renderChapterImages, shareChapterImages } from '../../lib/chapterLongImage'
import type { UiWorkspaceIdentity } from '../../lib/workspaceUiScope'
import { CHAPTER_STATUS_LABEL, cn, countWords } from '../../lib/utils'
import type { ChapterBox, ChapterDoc, ChapterStatus, TrashEntry } from '../../../../shared/types'
import { boxForChapterStatus } from '../../../../shared/chapterPlacement'
import { useChat } from '../../stores/chatStore'
import { chatDraftScope, chatDraftStore } from '../../stores/chatDraftStore'
import { useSettings } from '../../stores/settingsStore'
import { useUi } from '../../stores/uiStore'
import { useWorkspace } from '../../stores/workspaceStore'

const STATUS_TONE: Record<ChapterStatus, 'default' | 'accent' | 'ok'> = {
  draft: 'default',
  revised: 'accent',
  body: 'accent',
  final: 'ok'
}

export function ChapterTrashRow({ item, onRestore, onPurge }: { item: TrashEntry; onRestore: (id: string) => void; onPurge: (item: TrashEntry) => void }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-elevated">
      <Trash2 size={14} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => onRestore(item.id)} title="恢复"><Undo2 size={13} /></Button>
        <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => onPurge(item)} title="永久删除"><Trash2 size={13} /></Button>
      </div>
    </div>
  )
}

export function ChaptersPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const uiSource = useWorkspace((s) => s.uiSource)
  const refresh = useWorkspace((s) => s.refresh)
  const setAttachments = useChat((s) => s.setAttachments)
  const setMessageFiles = useChat((s) => s.setMessageFiles)
  const openChatPanel = useUi((s) => s.openChatPanel)

  const [box, setBox] = useState<ChapterBox>('main')
  const [trashItems, setTrashItems] = useState<TrashEntry[]>([])
  const chapters = useMemo(() => [...(summary?.chapters ?? [])].filter((c) => (c.box ?? 'main') === box).sort((a, b) => a.order - b.order), [summary?.chapters, box])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<(Partial<ChapterDoc> & { id?: string }) | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [purgeTarget, setPurgeTarget] = useState<TrashEntry | null>(null)
  const [trashActionError, setTrashActionError] = useState<string | null>(null)
  const [reloadHint, setReloadHint] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [copiedChapterId, setCopiedChapterId] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sharingImage, setSharingImage] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorHandle | null>(null)
  /** 打开（或最近一次同步）时的磁盘内容，用于检测智能体等外部修改 */
  const baseRef = useRef<string>('')
  const openRequestRef = useRef(0)
  const initialWorkspaceRef = useRef<string | null>(null)
  const readingStateRef = useRef<ChapterReadingState | null>(null)
  const [chapterError, setChapterError] = useState<string | null>(null)
  const [failedChapterId, setFailedChapterId] = useState<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const lastApplied = useChat((s) => s.lastAppliedChange)

  const selected = chapters.find((c) => c.id === selectedId) ?? null
  const selectedWordCount = selected && draft?.id === selected.id ? countWords(String(draft.content ?? '')) : selected?.wordCount ?? 0
  const volumes = summary?.volumes ?? []
  const workspaceIdentity = useMemo<UiWorkspaceIdentity | null>(() => summary ? { source: uiSource ?? 'electron-local', path: summary.path } : null, [summary?.path, uiSource])
  const workspaceKey = workspaceIdentity ?? ''
  const chapterListRef = useRef<HTMLDivElement | null>(null)
  const chapterReadOnlyRef = useRef<HTMLDivElement | null>(null)
  const chapterEditorRef = useRef<HTMLDivElement | null>(null)
  const chapterReaderRef = draft ? chapterEditorRef : chapterReadOnlyRef

  usePersistentScrollPosition(chapterListRef, workspaceKey, `chapters:list:${box}`)
  usePersistentScrollPosition(chapterReaderRef, workspaceKey, `chapters:reader:${box}:${draft?.id ?? selectedId ?? 'overview'}`, Boolean(draft && editorReady))

  useEffect(() => { void api.listTrash().then(setTrashItems).catch(() => setTrashItems([])) }, [summary?.trashCount])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: PointerEvent): void => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  useEffect(() => setMenuOpen(false), [draft?.id, box])

  const persistReading = (patch: Partial<ChapterReadingState>): void => {
    if (!workspaceIdentity) return
    const storage = (() => { try { return globalThis.localStorage } catch { return null } })()
    const current = readingStateRef.current ?? { version: 1 as const, activeBox: box === 'trash' ? 'trash' : box, lastChapterByBox: {}, updatedAt: 0 }
    const next = { ...current, ...patch, updatedAt: Date.now() }
    readingStateRef.current = next
    writeChapterReadingState(storage, chapterReadingStorageKey(JSON.stringify([workspaceIdentity.source, workspaceIdentity.path])), next)
  }

  const loadChapter = async (id: string, requestedBox: Exclude<ChapterBox, 'trash'>, force = false): Promise<void> => {
    const target = [...(summary?.chapters ?? [])].filter((chapter) => (chapter.box ?? 'main') === requestedBox).find((chapter) => chapter.id === id)
    if (!target) return
    if (!force && draft?.id === target.id) return
    if (!canSwitchDocument({ currentId: draft?.id ?? selectedId, targetId: target.id, dirty, confirmDiscard: () => window.confirm('当前章节有未保存的修改，放弃并切换？') })) return
    const requestId = ++openRequestRef.current
    setChapterError(null)
    setFailedChapterId(null)
    setEditorReady(false)
    let body: string | null
    try {
      body = await api.getChapterBody(id)
    } catch (error) {
      if (requestId === openRequestRef.current) { setChapterError(error instanceof Error ? error.message : String(error)); setFailedChapterId(id) }
      return
    }
    if (requestId !== openRequestRef.current) return
    if (body === null) {
      setChapterError('章节正文不存在或无法读取，请重试。')
      setFailedChapterId(id)
      return
    }
    baseRef.current = body
    setBox(requestedBox)
    setSelectedId(target.id)
    setDraft({ ...target, content: body })
    setDirty(false)
    setReloadHint(false)
    persistReading({ activeBox: requestedBox, lastChapterByBox: { ...(readingStateRef.current?.lastChapterByBox ?? {}), [requestedBox]: target.id } })
  }

  const openChapter = async (meta: { id: string }): Promise<void> => { await loadChapter(meta.id, box === 'trash' ? 'main' : box) }

  const changeBox = (next: ChapterBox): void => {
    if (next === box) return
    if (!canSwitchDocument({ currentId: draft?.id ?? selectedId, targetId: null, dirty, confirmDiscard: () => window.confirm('当前章节有未保存的修改，放弃并切换？') })) return
    openRequestRef.current += 1
    setBox(next)
    setSelectedId(null)
    setDraft(null)
    setDirty(false)
    setChapterError(null)
    setFailedChapterId(null)
    setEditorReady(false)
    persistReading({ activeBox: next })
    if (next !== 'trash') {
      const target = resolveChapterTarget(readingStateRef.current, {
        main: [...(summary?.chapters ?? [])].filter((chapter) => (chapter.box ?? 'main') === 'main'),
        draft: [...(summary?.chapters ?? [])].filter((chapter) => (chapter.box ?? 'main') === 'draft')
      })
      if (target.box === next && target.chapterId) void loadChapter(target.chapterId, next, true)
    }
  }

  useEffect(() => {
    if (!summary || !workspaceIdentity) return
    const key = JSON.stringify([workspaceIdentity.source, workspaceIdentity.path])
    if (initialWorkspaceRef.current === key) return
    initialWorkspaceRef.current = key
    openRequestRef.current += 1
    const storage = (() => { try { return globalThis.localStorage } catch { return null } })()
    const remembered = readChapterReadingState(storage, chapterReadingStorageKey(key))
    readingStateRef.current = remembered
    const target = resolveChapterTarget(remembered, {
      main: [...summary.chapters].filter((chapter) => (chapter.box ?? 'main') === 'main'),
      draft: [...summary.chapters].filter((chapter) => (chapter.box ?? 'main') === 'draft')
    })
    setBox(target.box)
    setSelectedId(null)
    setDraft(null)
    setDirty(false)
    setEditorReady(false)
    if (target.box === 'trash' || !target.chapterId) return
    void loadChapter(target.chapterId, target.box, true)
    // Initial restoration is intentionally keyed only by the opened workspace.
    // Metadata refreshes must not replace an editor the user is already working in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.path, uiSource])

  /** 拉取当前打开章节的最新磁盘内容并同步到草稿 */
  const reloadOpen = async (): Promise<void> => {
    if (!draft?.id) return
    let body: string | null
    try {
      body = await api.getChapterBody(draft.id)
    } catch (error) {
      setChapterError(error instanceof Error ? error.message : String(error))
      return
    }
    if (body === null) {
      setChapterError('章节正文不存在或无法读取，请重试。')
      return
    }
    baseRef.current = body
    setDraft((d) => (d ? { ...d, content: body } : d))
    setDirty(false)
    setReloadHint(false)
  }

  /** 智能体写回了当前打开的章节：无本地改动则静默同步，有改动则提示 */
  useEffect(() => {
    if (lastApplied && lastApplied.entityKind === 'chapter' && draft && lastApplied.entityId === draft.id) {
      if (dirty) setReloadHint(true)
      else void reloadOpen()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastApplied])

  const create = async (): Promise<void> => {
    await api.saveChapter({
      title: `第${chapters.length + 1}章`,
      volume: volumes[0]?.title ?? '第一卷',
      volumeId: volumes[0]?.id ?? 'vol_default',
      box,
      order: (chapters.length ? Math.max(...chapters.map((c) => c.order)) : 0) + 1,
      status: box === 'draft' ? 'draft' : 'body',
      content: ''
    })
    const fresh = await useWorkspace.getState().refresh().then(() => useWorkspace.getState().summary)
    const last = fresh?.chapters[fresh.chapters.length - 1]
    if (last) {
      setSelectedId(last.id)
      setDraft({ ...last, content: '' })
      baseRef.current = ''
      setDirty(false)
      setReloadHint(false)
    }
  }

  const doSave = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await api.saveChapter(draft)
      baseRef.current = draft.content ?? ''
      await refresh()
      const savedBox = saved.box === 'draft' ? 'draft' : 'main'
      setBox(savedBox)
      setSelectedId(saved.id)
      setDraft({ ...draft, ...saved, content: draft.content ?? '' })
      persistReading({ activeBox: savedBox, lastChapterByBox: { ...(readingStateRef.current?.lastChapterByBox ?? {}), [savedBox]: saved.id } })
      setDirty(false)
      setReloadHint(false)
    } finally {
      setSaving(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    // 保存前比对磁盘内容：智能体等外部修改过则先征求用户意见，避免静默覆盖
    if (draft.id) {
      const disk = await api.getChapterBody(draft.id)
      if (disk !== null && disk !== baseRef.current) {
        setConfirmOverwrite(true)
        return
      }
    }
    await doSave()
  }

  /** 空闲自动保存：只在有未保存改动时计时，到点仍走 save()（外部修改照旧弹确认） */
  const autosaveSeconds = useSettings((s) => s.settings?.autosaveSeconds ?? 0)
  const generationPreferences = useSettings((s) => s.settings?.agentGeneration)
  const autosave = useMemo(() => createAutosave(autosaveSeconds * 1000), [autosaveSeconds])
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  // 离开页面时把未到点的自动保存立即执行一次，避免改动丢失。
  // 声明在调度 effect 之前：React 卸载按声明顺序跑 cleanup，先 flush 再 cancel。
  useEffect(() => () => autosave.flush(), [autosave])

  useEffect(() => {
    if (!dirty || !draft || autosaveSeconds <= 0) {
      // 没有未保存改动：丢弃待执行回调，避免干净状态卸载时多写一次磁盘
      autosave.discard()
      return
    }
    autosave.schedule(() => void saveRef.current().catch(() => {}))
    return () => autosave.cancel()
  }, [draft?.title, draft?.content, dirty, autosave, autosaveSeconds])

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    // 章节即将被删除：先丢弃待执行的自动保存，避免删完又被写回来
    autosave.discard()
    await api.deleteChapter(selectedId)
    setConfirmDelete(false)
    setSelectedId(null)
    setDraft(null)
    await refresh()
  }

  const createVolume = async (): Promise<void> => {
    const title = window.prompt('卷名', `第${volumes.length + 1}卷`)?.trim()
    if (!title) return
    await api.saveVolume({ title, order: volumes.length + 1 })
    await refresh()
  }

  const moveOpenChapter = async (): Promise<void> => {
    if (!draft?.id) return
    if (dirty) { setActionMessage('请先保存当前章节，再移动箱位'); return }
    const targetBox = draft.box === 'draft' ? 'main' : 'draft'
    try {
      await api.moveChapter(draft.id, { box: targetBox, volumeId: draft.volumeId })
      await refresh()
      const updated = useWorkspace.getState().summary?.chapters.find((chapter) => chapter.id === draft.id)
      setBox(targetBox)
      setSelectedId(draft.id)
      setDraft({ ...draft, ...updated, content: draft.content ?? '' })
      persistReading({ activeBox: targetBox, lastChapterByBox: { ...(readingStateRef.current?.lastChapterByBox ?? {}), [targetBox]: draft.id } })
      setDirty(false)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const restore = async (id: string): Promise<void> => { await api.restoreTrash(id); await refresh(); setTrashItems(await api.listTrash()) }

  const purge = async (): Promise<void> => {
    if (!purgeTarget) return
    try {
      setTrashActionError(null)
      await api.purgeTrash(purgeTarget.id)
      const items = await api.listTrash()
      setTrashItems(items)
      setPurgeTarget(null)
      await refresh()
    } catch (error) {
      setTrashActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const copyChapter = async (id: string, content?: string): Promise<void> => {
    setCopyError(null)
    try {
      const text = content ?? (await api.getChapterBody(id)) ?? ''
      await copyPlainText(text)
      setCopiedChapterId(id)
      window.setTimeout(() => setCopiedChapterId((current) => (current === id ? null : current)), 1800)
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error))
    }
  }

  const downloadChapterMarkdown = (): void => {
    if (!draft) return
    const blob = new Blob([draft.content ?? ''], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${imageFileStem(draft.title ?? '章节')}.md`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const shareChapter = async (): Promise<void> => {
    if (!draft || sharingImage) return
    setSharingImage(true)
    setActionMessage(null)
    try {
      const images = await renderChapterImages(draft.title ?? '章节', draft.content ?? '')
      const result = await shareChapterImages(images)
      setActionMessage(result === 'downloaded' ? `已下载 ${images.length} 张长图` : '已打开分享窗口')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setActionMessage(error instanceof Error ? error.message : String(error))
    } finally { setSharingImage(false) }
  }

  /** 把当前章节挂到智能体上下文，跳转工作台 */
  const askAi = async (task?: string, agent?: ChapterTextAgent): Promise<void> => {
    const target = draft?.id ? { id: draft.id, title: draft.title ?? selected?.title ?? '当前章节' } : selected
    if (!target || (agent && !chapterTextAgentEnabled(agent, generationPreferences))) return
    if (agent && dirty) {
      useChat.setState({ error: '请先保存当前章节，再启动润色候选，避免智能体读取旧版本。' })
      openChatPanel()
      return
    }
    setAttachments([{ kind: 'chapter', id: target.id, label: target.title, ...(agent ? { purpose: chapterTextAgentPurpose(agent) } : {}) }])
    setMessageFiles([])
    // 由聊天侧栏统一负责模型、模式和发送事务；快捷动作只填入草稿，避免绕过默认模型。
    const chat = useChat.getState()
    const settings = useSettings.getState().settings
    if (agent && chat.creativePreferences?.orchestrationEnabled) {
      try {
        await chat.updateCreativePreferences(creativePreferencesForMode(chat.creativePreferences, settings ?? undefined, false))
      } catch (error) {
        useChat.setState({ error: error instanceof Error ? error.message : String(error) })
        openChatPanel()
        return
      }
    }
    chatDraftStore.setText(chatDraftScope({ source: uiSource ?? 'electron-local', path: summary?.path ?? '' }, chat.activeId), task ?? '请基于当前章节和项目资料提出续写建议；先读取相关设定，未经确认不要写回。')
    openChatPanel()
  }

  return (
    <div data-android-document-layout className="flex h-full min-h-0 flex-col sm:flex-row">
      {/* 章节列表 */}
      <div data-android-list-pane className="flex h-64 w-full shrink-0 flex-col border-b border-line bg-panel sm:h-auto sm:w-72 sm:border-b-0 sm:border-r">
        <div className="shrink-0 border-b border-line px-3 py-3">
          <div data-android-chapter-actions className="flex min-w-0 items-center gap-2">
            <div role="tablist" aria-label="章节箱" className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-lg bg-elevated p-1">
              <Button size="sm" className="h-8 min-w-0 justify-center px-2" variant={box === 'draft' ? 'soft' : 'ghost'} onClick={() => changeBox('draft')}>草稿箱</Button>
              <Button size="sm" className="h-8 min-w-0 justify-center px-2" variant={box === 'main' ? 'soft' : 'ghost'} onClick={() => changeBox('main')}>正文箱</Button>
              <Button size="sm" className="h-8 min-w-0 justify-center px-2" variant={box === 'trash' ? 'soft' : 'ghost'} onClick={() => changeBox('trash')}>
                <ArchiveRestore size={13} className="shrink-0" />
                <span className="hidden min-[420px]:inline">回收站</span>
                <span className="min-[420px]:hidden">回收</span>
              </Button>
            </div>
            {box !== 'trash' && <Button size="sm" variant="primary" className="h-9 shrink-0 px-3" onClick={() => void create()}><Plus size={14} /> 新建</Button>}
          </div>
          {box !== 'trash' && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <BookOpen size={14} className="text-accent" />
                <span>{box === 'main' ? '正文结构' : '待整理章节'}</span>
              </div>
              {box === 'main' && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void createVolume()} title="新建卷"><FolderPlus size={13} /> 新建卷</Button>}
            </div>
          )}
        </div>
        <div ref={chapterListRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {box === 'trash' ? <>{trashActionError && <div className="mb-2 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-2 text-xs text-danger">{trashActionError}</div>}{trashItems.filter((item) => item.kind === 'chapter').map((item) => <ChapterTrashRow key={item.id} item={item} onRestore={(id) => void restore(id)} onPurge={(target) => { setTrashActionError(null); setPurgeTarget(target) }} />)}</> : <>
          {chapters.length === 0 && <EmptyState icon={<BookOpen size={26} />} title="还没有章节" hint="新建第一章开始写作" />}
          {(box === 'draft' ? [{ id: 'draft', title: '草稿箱', order: 0 }] : volumes).map((vol) => (
            <div key={vol.id} className="mb-3">
              <div className="mb-2 flex items-center gap-2 border-b border-line/70 px-1 pb-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 truncate text-xs font-semibold text-muted">{vol.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-faint">{chapters.filter((c) => box === 'draft' || (c.volumeId ?? 'vol_default') === vol.id).length} 章</span>
              </div>
              <div className="space-y-2">
                {chapters
                  .filter((c) => box === 'draft' || (c.volumeId ?? 'vol_default') === vol.id)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => void openChapter(c)}
                      className={`list-row w-full rounded-xl border px-3 py-2.5 text-left transition cursor-pointer ${
                        selectedId === c.id ? 'border-accent/40 bg-accent-soft text-accent shadow-sm' : 'border-line/70 bg-app hover:border-line hover:bg-elevated'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium">{c.title}</span>
                        <Badge tone={STATUS_TONE[c.status]} className="ml-auto shrink-0">
                          {CHAPTER_STATUS_LABEL[c.status]}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-faint">{draft?.id === c.id ? countWords(String(draft.content ?? '')) : c.wordCount} 字</div>
                    </button>
                  ))}
              </div>
            </div>
          ))}</>}
        </div>
      </div>

      {/* 编辑区 */}
      {!draft ? (
        <div ref={chapterReaderRef} className="flex-1 overflow-y-auto">
          {chapterError ? (
            <div className="mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center">
              <EmptyState icon={<BookOpen size={28} />} title="章节正文加载失败" hint={chapterError} />
              {failedChapterId && box !== 'trash' && <Button variant="outline" onClick={() => void loadChapter(failedChapterId, box)}>重试</Button>}
            </div>
          ) : selected ? (
            <div className="mx-auto max-w-3xl p-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copyChapter(selected.id)}>
                    {copiedChapterId === selected.id ? <Check size={13} /> : <Copy size={13} />}
                    {copiedChapterId === selected.id ? '已复制' : '复制全章'}
                  </Button>
                  <Button size="sm" onClick={() => void openChapter(selected)}>
                    打开编辑
                  </Button>
                </div>
              </div>
              {copyError && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                  <span>{copyError}</span>
                  <button type="button" className="cursor-pointer font-medium" onClick={() => setCopyError(null)}>关闭</button>
                </div>
              )}
              <EmptyState icon={<BookOpen size={28} />} title={`${selectedWordCount} 字`} hint="点击「打开编辑」继续写作" />
            </div>
          ) : (
            <EmptyState icon={<BookOpen size={32} />} title="选择左侧章节" hint="或新建一章开始写作" />
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-5">
            <Input value={draft.title ?? ''} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true) }} className="max-w-56" />
            <select
              value={draft.volumeId ?? volumes[0]?.id ?? 'vol_default'}
              onChange={(e) => { const volume = volumes.find((item) => item.id === e.target.value); setDraft({ ...draft, volumeId: e.target.value, volume: volume?.title ?? draft.volume }); setDirty(true) }}
              className={cn('h-9 rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-accent cursor-pointer')}
            >
              {(volumes.length ? volumes : [{ id: 'vol_default', title: draft.volume ?? '第一卷', order: 1 }]).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
            <select
              value={draft.status ?? 'draft'}
              onChange={(e) => { const status = e.target.value as ChapterStatus; setDraft({ ...draft, status, box: boxForChapterStatus(status) }); setDirty(true) }}
              className="h-9 rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-accent cursor-pointer"
            >
              <optgroup label="草稿箱">{(['draft', 'revised'] as const).map((s) => <option key={s} value={s}>{CHAPTER_STATUS_LABEL[s]}</option>)}</optgroup>
              <optgroup label="正文箱">{(['body', 'final'] as const).map((s) => <option key={s} value={s}>{CHAPTER_STATUS_LABEL[s]}</option>)}</optgroup>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              序号
              <Input type="number" value={draft.order ?? 1} onChange={(e) => { setDraft({ ...draft, order: Number(e.target.value) || 1 }); setDirty(true) }} className="w-16" />
            </label>
            <Input value={(draft.terms ?? []).map((term) => term.term).join('，')} onChange={(e) => { const terms = e.target.value.split(/[,，、\s]+/).map((term) => term.trim()).filter(Boolean).map((term) => ({ term })); setDraft({ ...draft, terms }); setDirty(true) }} placeholder="术语标注" className="max-w-40" title="用逗号分隔章节中的陌生名词" />
            {dirty && <span className="text-xs text-accent">未保存</span>}
            <div className="hidden flex-1 sm:block" />
            <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setDirty(false) }}>
              完成
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void askAi()} title="让智能体基于本章设定续写">
              <Sparkles size={13} /> AI 续写
            </Button>
            <Button variant="ghost" size="sm" disabled={!draft.id || !chapterTextAgentEnabled('polish', generationPreferences)} onClick={() => void askAi(chapterTextAgentTask('polish', { id: draft.id ?? '', title: draft.title ?? '当前章节' }), 'polish')} title="普通模式 AI 润色">AI 润色</Button>
            <Button variant="ghost" size="sm" disabled={!draft.id || !chapterTextAgentEnabled('de-ai', generationPreferences)} onClick={() => void askAi(chapterTextAgentTask('de-ai', { id: draft.id ?? '', title: draft.title ?? '当前章节' }), 'de-ai')} title="普通模式去 AI 风格">去 AI 风格</Button>
            <div ref={menuRef} className="relative">
              <Button variant="outline" size="sm" aria-label="章节更多操作" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Menu size={16} /></Button>
              {menuOpen && <div role="menu" aria-label="章节操作" className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-line bg-panel p-1 shadow-lg">
                <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => { setMenuOpen(false); markdownEditorRef.current?.openSearch() }}><Search size={14} /> 查找与替换</button>
                <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => { setMenuOpen(false); markdownEditorRef.current?.undo() }}><Undo2 size={14} /> 撤销</button>
                <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => { setMenuOpen(false); markdownEditorRef.current?.redo() }}><Redo2 size={14} /> 重做</button>
                <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => { setMenuOpen(false); markdownEditorRef.current?.selectAll() }}><TextSelect size={14} /> 全选正文</button>
                <div className="my-1 border-t border-line" />
                <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => { setMenuOpen(false); void copyChapter(draft.id ?? 'draft', draft.content ?? '') }}><Copy size={14} /> {copiedChapterId === (draft.id ?? 'draft') ? '已复制' : '复制全章'}</button>
                <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => { setMenuOpen(false); downloadChapterMarkdown() }}><Download size={14} /> 导出 Markdown</button>
                <button role="menuitem" type="button" disabled={sharingImage} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated disabled:opacity-50" onClick={() => { setMenuOpen(false); void shareChapter() }}><FileImage size={14} /> {sharingImage ? '生成中…' : '生成长图分享'}</button>
                {draft.id && <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => { setMenuOpen(false); void moveOpenChapter() }}><ArchiveRestore size={14} /> {draft.box === 'draft' ? '移入正文箱' : '移入草稿箱'}</button>}
                <div className="my-1 border-t border-line" />
                <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-elevated" onClick={() => { setMenuOpen(false); setConfirmDelete(true) }}><Trash2 size={14} /> 删除章节</button>
              </div>}
            </div>
            <Button variant="primary" size="sm" onClick={() => void save()} loading={saving}>
              <Save size={13} /> 保存
            </Button>
          </div>

          {reloadHint && (
            <div className="flex items-center gap-2 border-b border-line bg-accent-soft px-5 py-2 text-xs text-accent">
              智能体已更新此章节，而你有未保存的本地修改。
              <Button size="sm" variant="soft" onClick={() => void reloadOpen()}>
                载入最新版（放弃本地修改）
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReloadHint(false)}>
                继续编辑我的版本
              </Button>
            </div>
          )}

          {copyError && (
            <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger-soft px-5 py-2 text-xs text-danger">
              <span>{copyError}</span>
              <button type="button" className="cursor-pointer font-medium" onClick={() => setCopyError(null)}>关闭</button>
            </div>
          )}

          {actionMessage && <div role="status" className="flex items-center justify-between border-b border-line px-5 py-2 text-xs text-muted"><span>{actionMessage}</span><button type="button" onClick={() => setActionMessage(null)}>关闭</button></div>}

          <div className="min-h-0 flex-1 p-4">
            <MarkdownEditor
              ref={markdownEditorRef}
              value={draft.content ?? ''}
              chapterFormatting
              documentId={draft.id}
              onLayoutReady={(documentId) => { if (documentId === draft.id) setEditorReady(true) }}
              onChange={(content) => { setDraft({ ...draft, content }); setDirty(true) }}
              scrollRef={chapterReaderRef}
            />
          </div>

          <div className="flex h-8 shrink-0 items-center border-t border-line px-4 text-xs text-faint">
            {countWords(draft.content ?? '')} 字
          </div>
        </div>
      )}

      <Modal open={confirmOverwrite} onOpenChange={setConfirmOverwrite} title="章节已被外部修改" description="磁盘上的内容与你打开时不一致（可能来自智能体写回或其他编辑器）">
        <p className="text-sm text-muted">选择「覆盖」将以你当前编辑器里的内容为准；选择「载入最新版」将放弃本地修改。</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOverwrite(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              setConfirmOverwrite(false)
              void reloadOpen()
            }}
          >
            载入最新版
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmOverwrite(false)
              void doSave()
            }}
          >
            覆盖磁盘内容
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${selected?.title ?? ''}」？`}>
        <p className="text-sm text-muted">此操作不可撤销。</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button variant="danger" onClick={() => void remove()}>
            确认删除
          </Button>
        </div>
      </Modal>

      <Modal open={Boolean(purgeTarget)} onOpenChange={(open) => { if (!open) { setPurgeTarget(null); setTrashActionError(null) } }} title={`永久删除「${purgeTarget?.title ?? ''}」？`}>
        <p className="text-sm text-muted">此操作不可恢复。</p>
        {trashActionError && <p className="mt-3 text-xs text-danger">{trashActionError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setPurgeTarget(null); setTrashActionError(null) }}>
            取消
          </Button>
          <Button variant="danger" onClick={() => void purge()}>
            永久删除
          </Button>
        </div>
      </Modal>
    </div>
  )
}
