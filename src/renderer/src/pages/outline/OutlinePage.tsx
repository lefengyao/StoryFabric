import { ListTree, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Markdown } from '../../components/markdown/Markdown'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { useDocumentHistoryEditor } from '../../features/documentHistory/useDocumentHistoryEditor'
import { EditorHistoryActions } from '../../features/documentHistory/EditorHistoryActions'
import { loadDocumentIntoEditor } from '../../features/documentHistory/documentRead'
import { DocumentImageExport } from '../../features/imageExport/DocumentImageExport'
import { usePersistentScrollPosition } from '../../lib/persistentScroll'
import type { OutlineDoc, OutlineKind } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'

const UNASSIGNED_FILTER = '__unassigned__'

export function OutlinePage(): React.ReactElement {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const summary = useWorkspace((s) => s.summary)
  const uiSource = useWorkspace((s) => s.uiSource)
  const refresh = useWorkspace((s) => s.refresh)
  const docs = summary?.outline ?? []
  const chapters = summary?.chapters ?? []
  const volumes = summary?.volumes ?? []
  const [kind, setKind] = useState<OutlineKind>('total')
  const [volumeId, setVolumeId] = useState<string>('')
  const [chapterId, setChapterId] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string | null>(docs[0]?.id ?? null)
  const [draft, setDraft] = useState<OutlineDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadHint, setReloadHint] = useState(false)
  const requestRef = useRef(0)

  const chapterById = useMemo(() => new Map(chapters.map((chapter) => [chapter.id, chapter])), [chapters])
  const visibleChapters = useMemo(() => chapters.filter((chapter) => !volumeId || (chapter.volumeId ?? 'vol_default') === volumeId), [chapters, volumeId])
  const filteredDocs = useMemo(() => docs.filter((doc) => {
    if ((doc.kind ?? 'total') !== kind) return false
    if (kind === 'total') return true
    if (chapterId === UNASSIGNED_FILTER) return !doc.chapterId
    if (chapterId && doc.chapterId !== chapterId) return false
    const chapter = doc.chapterId ? chapterById.get(doc.chapterId) : undefined
    if (!chapter) return !volumeId
    if (volumeId && (chapter.volumeId ?? 'vol_default') !== volumeId) return false
    return true
  }), [chapterById, chapterId, docs, kind, volumeId])
  const selected = filteredDocs.find((d) => d.id === selectedId) ?? filteredDocs[0] ?? null
  const workspaceKey = useMemo(() => summary ? { source: uiSource ?? 'electron-local', path: summary.path } : '', [summary?.path, uiSource])
  const history = useDocumentHistoryEditor<OutlineDoc>({
    kind: 'outline', workspaceKey: JSON.stringify(workspaceKey),
    onDocument: (document, changed) => { setDraft(document); setDirty(changed) },
    onSaved: async (saved) => {
      const previousChapterId = docs.find((doc) => doc.id === saved.id)?.chapterId
      if (saved.kind === 'chapter' && previousChapterId !== saved.chapterId) { setVolumeId(''); setChapterId(saved.chapterId ?? UNASSIGNED_FILTER) }
      setReloadHint(false)
      await refresh()
    }
  })
  const outlineListRef = useRef<HTMLDivElement | null>(null)
  const outlineReadOnlyRef = useRef<HTMLDivElement | null>(null)
  const outlineEditorRef = useRef<HTMLDivElement | null>(null)
  const outlineReaderRef = draft ? outlineEditorRef : outlineReadOnlyRef

  usePersistentScrollPosition(outlineListRef, workspaceKey, `outline:list:${kind}:${chapterId || 'all'}`)
  usePersistentScrollPosition(outlineReaderRef, workspaceKey, `outline:reader:${kind}:${chapterId || 'all'}:${draft?.id ?? selected?.id ?? 'overview'}`)

  const openDoc = async (d: OutlineDoc | null, force = false): Promise<void> => {
    if (!force && !await history.leave()) return
    const request = ++requestRef.current
    setLoadError(null)
    if (!d) { history.reset(); setDraft(null); setSelectedId(null); setDirty(false); return }
    try {
      const result = await loadDocumentIntoEditor({
        read: () => api.getDocumentSnapshot('outline', d.id), generation: history.editGeneration,
        isCurrent: () => request === requestRef.current,
        apply: (snapshot) => { setSelectedId(d.id); history.begin(snapshot); setReloadHint(false) }
      })
      if (result === 'edited') setReloadHint(true)
    } catch (error) { if (request === requestRef.current) setLoadError(error instanceof Error ? error.message : String(error)) }
  }

  const changeFilter = async (apply: () => void): Promise<void> => {
    if (!await history.leave()) return
    requestRef.current++
    history.reset(); setDraft(null); setSelectedId(null); setDirty(false); apply()
  }

  useEffect(() => {
    requestRef.current++
    setDraft(null); setDirty(false); setSelectedId(null); setLoadError(null)
    const requested = docs.find((document) => document.id === params.get('id'))
    if (requested) { setKind(requested.kind ?? 'total'); setVolumeId(''); setChapterId(''); void openDoc(requested, true) }
  }, [summary?.path, uiSource])
  useEffect(() => {
    if (!draft) return
    const current = docs.find((document) => document.id === draft.id)
    if (!current || !current.writeRevision || current.writeRevision === draft.writeRevision) return
    if (dirty) setReloadHint(true)
    else void openDoc(current, true)
  }, [docs])

  const create = async (): Promise<void> => {
    if (!await history.leave()) return
    const targetChapterId = chapterId === UNASSIGNED_FILTER ? undefined : chapterId || (volumeId ? visibleChapters[0]?.id : undefined)
    const saved = await api.saveOutlineDoc({ title: kind === 'total' ? '新总纲篇章' : '新章纲', kind, chapterId: kind === 'chapter' ? targetChapterId : undefined, order: (filteredDocs.length ? Math.max(...filteredDocs.map((x) => x.order)) : 0) + 1 })
    if (kind === 'chapter' && !targetChapterId) { setVolumeId(''); setChapterId(UNASSIGNED_FILTER) }
    await refresh()
    await openDoc(saved, true)
  }

  const save = async (): Promise<boolean> => {
    if (!draft) return false
    setSaving(true)
    try {
      const success = await history.save()
      if (!success) setReloadHint(true)
      return success
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    if (!await history.leave(false)) return
    history.reset()
    await api.deleteOutlineDoc(selectedId)
    setConfirmDelete(false)
    setSelectedId(null)
    setDraft(null)
    await refresh()
  }

  return (
    <div data-android-document-layout className="flex h-full min-h-0 flex-col sm:flex-row">
      <div data-android-list-pane className="flex h-52 w-full shrink-0 flex-col border-b border-line sm:h-auto sm:w-64 sm:border-b-0 sm:border-r">
        <div className="flex items-center justify-between p-3 pb-2">
          <div className="flex items-center gap-1"><Button size="sm" variant={kind === 'total' ? 'soft' : 'ghost'} onClick={() => void changeFilter(() => setKind('total'))}>总纲</Button><Button size="sm" variant={kind === 'chapter' ? 'soft' : 'ghost'} onClick={() => void changeFilter(() => setKind('chapter'))}>章纲</Button></div>
          <Button size="sm" variant="primary" onClick={() => void create()}>
            <Plus size={13} /> 新建
          </Button>
        </div>
        {kind === 'chapter' && (
          <div className="mx-3 mb-2 grid grid-cols-2 gap-2">
            <select value={volumeId} onChange={(e) => { const value = e.target.value; void changeFilter(() => { setVolumeId(value); setChapterId('') }) }} className="h-8 min-w-0 rounded-md border border-line bg-panel px-2 text-xs">
              <option value="">全部卷</option>
              {volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}</option>)}
            </select>
            <select value={chapterId} onChange={(e) => { const value = e.target.value; void changeFilter(() => setChapterId(value)) }} className="h-8 min-w-0 rounded-md border border-line bg-panel px-2 text-xs">
              <option value="">全部章节</option>
              <option value={UNASSIGNED_FILTER}>未关联章纲</option>
              {visibleChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
            </select>
          </div>
        )}
        <div ref={outlineListRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {filteredDocs.map((d) => (
            <button
              key={d.id}
              onClick={() => void openDoc(d)}
              className={`list-row w-full rounded-lg px-3 py-2 text-left transition cursor-pointer flex items-center gap-2 ${
                selectedId === d.id ? 'bg-accent-soft text-accent' : 'hover:bg-elevated'
              }`}
            >
              <ListTree size={14} className="shrink-0 opacity-60" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{d.title}</span>
                {kind === 'chapter' && (
                  <span className="mt-0.5 block truncate text-[10px] text-faint">
                    {d.chapterId ? volumes.find((volume) => volume.id === (chapterById.get(d.chapterId ?? '')?.volumeId ?? 'vol_default'))?.title ?? '未分卷' : '未关联章节'}
                  </span>
                )}
              </span>
              <Badge className="ml-auto">{d.order}</Badge>
            </button>
          ))}
        </div>
      </div>

      {!draft ? (
        <div ref={outlineReadOnlyRef} className="flex-1 overflow-y-auto">
          {selected ? (
            <article className="mx-auto max-w-3xl p-8">
              <h1 className="text-xl font-bold mb-4">{selected.title}</h1>
              <div className="mb-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => void openDoc(selected)}>打开编辑</Button><Button size="sm" variant="ghost" onClick={() => navigate(`/history?kind=outline&id=${encodeURIComponent(selected.id)}`)}>查看历史</Button><DocumentImageExport kind="outline" document={selected} workspaceName={summary?.name ?? ''} chapterTitle={chapterById.get(selected.chapterId ?? '')?.title} /></div>
              <Markdown text={selected.content} />
            </article>
          ) : (
            <EmptyState icon={<ListTree size={32} />} title="选择左侧大纲查看" hint="或新建一篇大纲文档" />
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col" onCompositionStartCapture={history.compositionStart} onCompositionEndCapture={history.compositionEnd}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-5">
            <Input value={draft.title} onChange={(e) => history.change({ ...draft, title: e.target.value })} className="max-w-xs" />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              序号
              <Input
                type="number"
                value={draft.order}
                onChange={(e) => history.change({ ...draft, order: Number(e.target.value) || 1 })}
                className="w-20"
              />
            </label>
            {kind === 'chapter' && <label className="flex items-center gap-1.5 text-xs text-muted">
              关联章节
              <select
                value={draft.chapterId ?? ''}
                onChange={(event) => history.change({ ...draft, chapterId: event.target.value })}
                className="h-8 max-w-44 rounded-md border border-line bg-panel px-2 text-xs text-fg"
              >
                <option value="">未关联</option>
                {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
              </select>
            </label>}
            {dirty && <span className="text-xs text-accent">未保存</span>}
            <div className="hidden flex-1 sm:block" />
            <Button variant="ghost" size="sm" onClick={() => { void history.leave().then((allowed) => { if (allowed) { history.reset(); setDraft(null); setDirty(false) } }) }}>
              完成
            </Button>
            <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} />
            </Button>
            <DocumentImageExport kind="outline" document={draft} workspaceName={summary?.name ?? ''} chapterTitle={chapterById.get(draft.chapterId ?? '')?.title} beforeExport={async () => !dirty || (window.confirm('先保存当前修改，再导出大纲图片？') && await save())} />
            <Button variant="primary" size="sm" onClick={() => void save()} loading={saving || history.state.saving}>
              保存
            </Button>
          </div>
          <EditorHistoryActions state={history.state} onCapture={() => void history.save('manual')} onRetry={() => void history.retry()} onHistory={() => { void history.leave().then((allowed) => { if (allowed) navigate(`/history?kind=outline&id=${encodeURIComponent(draft.id)}`) }) }} />
          {reloadHint && <div role="alert" className="flex flex-wrap gap-2 border-b border-line bg-accent-soft p-3 text-xs text-accent">当前文件已变化，本地草稿已保留。<Button size="sm" variant="ghost" onClick={() => { if (window.confirm('放弃本地草稿并读取当前文件？')) void openDoc(draft, true) }}>载入当前文件</Button><Button size="sm" variant="outline" onClick={() => { if (window.confirm('以本地草稿覆盖重新读取的当前文件？')) void history.overwrite() }}>确认覆盖</Button></div>}
          <div className="min-h-0 flex-1 p-4">
            <MarkdownEditor value={draft.content} onChange={(content) => history.change({ ...draft, content })} scrollRef={outlineReaderRef} documentId={draft.id} />
          </div>
        </div>
      )}
      {loadError && <div role="alert" className="p-3 text-sm text-danger">大纲读取失败：{loadError}<Button size="sm" variant="ghost" onClick={() => void openDoc(selected)}>重试</Button></div>}

      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${selected?.title ?? ''}」？`}>
        <p className="text-sm text-muted">当前大纲将永久删除，已有历史版本继续保留并可只读查看。</p>
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
