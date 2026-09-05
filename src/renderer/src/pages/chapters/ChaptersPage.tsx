import { ArchiveRestore, BookOpen, FolderPlus, Plus, Save, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { CHAPTER_STATUS_LABEL, cn, countWords } from '../../lib/utils'
import type { ChapterBox, ChapterDoc, ChapterStatus, TrashEntry } from '../../../../shared/types'
import { useChat } from '../../stores/chatStore'
import { useWorkspace } from '../../stores/workspaceStore'

const STATUS_TONE: Record<ChapterStatus, 'default' | 'accent' | 'ok'> = {
  draft: 'default',
  revised: 'accent',
  final: 'ok'
}

export function ChaptersPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const navigate = useNavigate()
  const setAttachments = useChat((s) => s.setAttachments)

  const [box, setBox] = useState<ChapterBox>('main')
  const [trashItems, setTrashItems] = useState<TrashEntry[]>([])
  const chapters = useMemo(() => [...(summary?.chapters ?? [])].filter((c) => (c.box ?? 'main') === box).sort((a, b) => a.order - b.order), [summary?.chapters, box])
  const [selectedId, setSelectedId] = useState<string | null>(chapters[0]?.id ?? null)
  const [draft, setDraft] = useState<(Partial<ChapterDoc> & { id?: string }) | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reloadHint, setReloadHint] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  /** 打开（或最近一次同步）时的磁盘内容，用于检测智能体等外部修改 */
  const baseRef = useRef<string>('')
  const lastApplied = useChat((s) => s.lastAppliedChange)

  const selected = chapters.find((c) => c.id === selectedId) ?? null
  const volumes = summary?.volumes ?? []

  useEffect(() => { void api.listTrash().then(setTrashItems).catch(() => setTrashItems([])) }, [summary?.trashCount])

  const openChapter = async (meta: { id: string }): Promise<void> => {
    if (draft && dirty && meta.id !== draft.id && !window.confirm('当前章节有未保存的修改，放弃并切换？')) return
    setSelectedId(meta.id)
    const body = await api.getChapterBody(meta.id)
    baseRef.current = body ?? ''
    setDraft({ ...(selected ?? chapters.find((c) => c.id === meta.id)!), content: body ?? '' })
    setDirty(false)
    setReloadHint(false)
  }

  /** 拉取当前打开章节的最新磁盘内容并同步到草稿 */
  const reloadOpen = async (): Promise<void> => {
    if (!draft?.id) return
    const body = await api.getChapterBody(draft.id)
    baseRef.current = body ?? ''
    setDraft((d) => (d ? { ...d, content: body ?? '' } : d))
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
      status: 'draft',
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
      await api.saveChapter(draft)
      baseRef.current = draft.content ?? ''
      await refresh()
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

  const remove = async (): Promise<void> => {
    if (!selectedId) return
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

  const restore = async (id: string): Promise<void> => { await api.restoreTrash(id); await refresh(); setTrashItems(await api.listTrash()) }

  /** 把当前章节挂到智能体上下文，跳转工作台 */
  const askAi = (): void => {
    if (!selected) return
    setAttachments([{ kind: 'chapter', id: selected.id, label: selected.title }])
    navigate('/chat')
  }

  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* 章节列表 */}
      <div className="flex h-64 w-full shrink-0 flex-col border-b border-line bg-panel sm:h-auto sm:w-72 sm:border-b-0 sm:border-r">
        <div className="shrink-0 border-b border-line px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div role="tablist" aria-label="章节箱" className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-lg bg-elevated p-1">
              <Button size="sm" className="h-8 min-w-0 justify-center px-2" variant={box === 'draft' ? 'soft' : 'ghost'} onClick={() => { setBox('draft'); setSelectedId(null); setDraft(null) }}>草稿箱</Button>
              <Button size="sm" className="h-8 min-w-0 justify-center px-2" variant={box === 'main' ? 'soft' : 'ghost'} onClick={() => { setBox('main'); setSelectedId(null); setDraft(null) }}>正文箱</Button>
              <Button size="sm" className="h-8 min-w-0 justify-center px-2" variant={box === 'trash' ? 'soft' : 'ghost'} onClick={() => { setBox('trash'); setSelectedId(null); setDraft(null) }}>
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
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {box === 'trash' ? trashItems.filter((item) => item.kind === 'chapter').map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-elevated"><Trash2 size={14} className="text-faint" /><span className="truncate text-sm">{item.title}</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => void restore(item.id)} title="恢复"><Undo2 size={13} /></Button></div>) : <>
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
                      onClick={() => draft === null && void openChapter(c)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition cursor-pointer ${
                        selectedId === c.id ? 'border-accent/40 bg-accent-soft text-accent shadow-sm' : 'border-line/70 bg-app hover:border-line hover:bg-elevated'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium">{c.title}</span>
                        <Badge tone={STATUS_TONE[c.status]} className="ml-auto shrink-0">
                          {CHAPTER_STATUS_LABEL[c.status]}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-faint">{c.wordCount} 字</div>
                    </button>
                  ))}
              </div>
            </div>
          ))}</>}
        </div>
      </div>

      {/* 编辑区 */}
      {!draft ? (
        <div className="flex-1">
          {selected ? (
            <div className="mx-auto max-w-3xl p-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <Button size="sm" onClick={() => void openChapter(selected)}>
                  打开编辑
                </Button>
              </div>
              <EmptyState icon={<BookOpen size={28} />} title={`${selected.wordCount} 字`} hint="点击「打开编辑」继续写作" />
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
              onChange={(e) => { setDraft({ ...draft, status: e.target.value as ChapterStatus }); setDirty(true) }}
              className="h-9 rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-accent cursor-pointer"
            >
              {(Object.keys(CHAPTER_STATUS_LABEL) as ChapterStatus[]).map((s) => (
                <option key={s} value={s}>
                  {CHAPTER_STATUS_LABEL[s]}
                </option>
              ))}
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
            {draft.id && <Button variant="ghost" size="sm" onClick={() => void api.moveChapter(draft.id!, { box: draft.box === 'draft' ? 'main' : 'draft', volumeId: draft.volumeId }) .then(() => refresh())} title={draft.box === 'draft' ? '移入正文箱' : '移入草稿箱'}>{draft.box === 'draft' ? '移入正文箱' : '移入草稿箱'}</Button>}
            <Button variant="ghost" size="sm" onClick={askAi} title="让智能体基于本章设定续写">
              <Sparkles size={13} /> AI 续写
            </Button>
            <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} />
            </Button>
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

          <div className="min-h-0 flex-1 p-4">
            <MarkdownEditor value={draft.content ?? ''} onChange={(content) => { setDraft({ ...draft, content }); setDirty(true) }} />
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
    </div>
  )
}
