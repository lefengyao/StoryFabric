import { BookOpen, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { CHAPTER_STATUS_LABEL, cn, countWords } from '../../lib/utils'
import type { ChapterDoc, ChapterStatus } from '../../../../shared/types'
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

  const chapters = useMemo(() => [...(summary?.chapters ?? [])].sort((a, b) => a.order - b.order), [summary?.chapters])
  const [selectedId, setSelectedId] = useState<string | null>(chapters[0]?.id ?? null)
  const [draft, setDraft] = useState<(Partial<ChapterDoc> & { id?: string }) | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const selected = chapters.find((c) => c.id === selectedId) ?? null
  const volumes = useMemo(() => [...new Set(chapters.map((c) => c.volume || '未分卷'))], [chapters])

  const openChapter = async (meta: { id: string }): Promise<void> => {
    setSelectedId(meta.id)
    const body = await api.getChapterBody(meta.id)
    setDraft({ ...(selected ?? chapters.find((c) => c.id === meta.id)!), content: body ?? '' })
    setDirty(false)
  }

  const create = async (): Promise<void> => {
    await api.saveChapter({
      title: `第${chapters.length + 1}章`,
      volume: volumes[0] ?? '第一卷',
      order: (chapters.length ? Math.max(...chapters.map((c) => c.order)) : 0) + 1,
      status: 'draft',
      content: ''
    })
    const fresh = await useWorkspace.getState().refresh().then(() => useWorkspace.getState().summary)
    const last = fresh?.chapters[fresh.chapters.length - 1]
    if (last) {
      setSelectedId(last.id)
      setDraft({ ...last, content: '' })
    }
    setDirty(false)
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      await api.saveChapter(draft)
      await refresh()
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    await api.deleteChapter(selectedId)
    setConfirmDelete(false)
    setSelectedId(null)
    setDraft(null)
    await refresh()
  }

  /** 把当前章节挂到智能体上下文，跳转工作台 */
  const askAi = (): void => {
    if (!selected) return
    setAttachments([{ kind: 'chapter', id: selected.id, label: selected.title }])
    navigate('/chat')
  }

  return (
    <div className="flex h-full">
      {/* 章节列表 */}
      <div className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between p-3 pb-2">
          <span className="text-xs font-medium text-muted">目录</span>
          <Button size="sm" variant="primary" onClick={() => void create()}>
            <Plus size={13} /> 新建
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {chapters.length === 0 && <EmptyState icon={<BookOpen size={26} />} title="还没有章节" hint="新建第一章开始写作" />}
          {volumes.map((vol) => (
            <div key={vol} className="mb-3">
              <div className="mb-1 px-1 text-[11px] font-semibold text-faint">{vol}</div>
              <div className="space-y-1">
                {chapters
                  .filter((c) => (c.volume || '未分卷') === vol)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => draft === null && void openChapter(c)}
                      className={`w-full rounded-lg px-2.5 py-2 text-left transition cursor-pointer ${
                        selectedId === c.id ? 'bg-accent-soft text-accent' : 'hover:bg-elevated'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{c.title}</span>
                        <Badge tone={STATUS_TONE[c.status]} className="ml-auto shrink-0">
                          {CHAPTER_STATUS_LABEL[c.status]}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint">{c.wordCount} 字</div>
                    </button>
                  ))}
              </div>
            </div>
          ))}
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
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <Input value={draft.title ?? ''} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true) }} className="max-w-56" />
            <select
              value={draft.volume ?? '第一卷'}
              onChange={(e) => { setDraft({ ...draft, volume: e.target.value }); setDirty(true) }}
              className={cn('h-9 rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-accent cursor-pointer')}
            >
              {[...new Set([...volumes, draft.volume ?? '', '第一卷', '第二卷', '第三卷'])].filter(Boolean).map((v) => (
                <option key={v} value={v}>
                  {v}
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
            {dirty && <span className="text-xs text-accent">未保存</span>}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setDirty(false) }}>
              完成
            </Button>
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

          <div className="min-h-0 flex-1 p-4">
            <MarkdownEditor value={draft.content ?? ''} onChange={(content) => { setDraft({ ...draft, content }); setDirty(true) }} />
          </div>

          <div className="flex h-8 shrink-0 items-center border-t border-line px-4 text-xs text-faint">
            {countWords(draft.content ?? '')} 字
          </div>
        </div>
      )}

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
