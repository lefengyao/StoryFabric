import { ListTree, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Markdown } from '../../components/markdown/Markdown'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { usePersistentScrollPosition } from '../../lib/persistentScroll'
import type { OutlineDoc, OutlineKind } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'

export function OutlinePage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const docs = summary?.outline ?? []
  const chapters = summary?.chapters ?? []
  const [kind, setKind] = useState<OutlineKind>('total')
  const [chapterId, setChapterId] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string | null>(docs[0]?.id ?? null)
  const [draft, setDraft] = useState<OutlineDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const filteredDocs = useMemo(() => docs.filter((doc) => (doc.kind ?? 'total') === kind && (kind === 'total' || !chapterId || doc.chapterId === chapterId)), [docs, kind, chapterId])
  const selected = filteredDocs.find((d) => d.id === selectedId) ?? filteredDocs[0] ?? null
  const workspaceKey = summary?.path ?? ''
  const outlineListRef = useRef<HTMLDivElement | null>(null)
  const outlineReadOnlyRef = useRef<HTMLDivElement | null>(null)
  const outlineEditorRef = useRef<HTMLDivElement | null>(null)
  const outlineReaderRef = draft ? outlineEditorRef : outlineReadOnlyRef

  usePersistentScrollPosition(outlineListRef, workspaceKey, `outline:list:${kind}:${chapterId || 'all'}`)
  usePersistentScrollPosition(outlineReaderRef, workspaceKey, `outline:reader:${kind}:${chapterId || 'all'}:${draft?.id ?? selected?.id ?? 'overview'}`)

  const openDoc = (d: OutlineDoc | null): void => {
    setSelectedId(d?.id ?? null)
    setDraft(d ? { ...d } : null)
    setDirty(false)
  }

  const create = async (): Promise<void> => {
    const saved = await api.saveOutlineDoc({ title: kind === 'total' ? '新总纲篇章' : '新章纲', kind, chapterId: kind === 'chapter' ? (chapterId || chapters[0]?.id) : undefined, order: (filteredDocs.length ? Math.max(...filteredDocs.map((x) => x.order)) : 0) + 1 })
    await refresh()
    openDoc(saved)
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      await api.saveOutlineDoc(draft)
      await refresh()
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    await api.deleteOutlineDoc(selectedId)
    setConfirmDelete(false)
    setSelectedId(null)
    setDraft(null)
    await refresh()
  }

  return (
    <div className="flex h-full flex-col sm:flex-row">
      <div className="flex h-52 w-full shrink-0 flex-col border-b border-line sm:h-auto sm:w-64 sm:border-b-0 sm:border-r">
        <div className="flex items-center justify-between p-3 pb-2">
          <div className="flex items-center gap-1"><Button size="sm" variant={kind === 'total' ? 'soft' : 'ghost'} onClick={() => { setKind('total'); setSelectedId(null); setDraft(null) }}>总纲</Button><Button size="sm" variant={kind === 'chapter' ? 'soft' : 'ghost'} onClick={() => { setKind('chapter'); setSelectedId(null); setDraft(null) }}>章纲</Button></div>
          <Button size="sm" variant="primary" onClick={() => void create()}>
            <Plus size={13} /> 新建
          </Button>
        </div>
        {kind === 'chapter' && <select value={chapterId} onChange={(e) => { setChapterId(e.target.value); setSelectedId(null); setDraft(null) }} className="mx-3 mb-2 h-8 rounded-md border border-line bg-panel px-2 text-xs"><option value="">全部章节</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>}
        <div ref={outlineListRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {filteredDocs.map((d) => (
            <button
              key={d.id}
              onClick={() => draft === null && openDoc(d)}
              className={`list-row w-full rounded-lg px-3 py-2 text-left transition cursor-pointer flex items-center gap-2 ${
                selectedId === d.id ? 'bg-accent-soft text-accent' : 'hover:bg-elevated'
              }`}
            >
              <ListTree size={14} className="shrink-0 opacity-60" />
              <span className="truncate text-sm">{d.title}</span>
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
              <Markdown text={selected.content} />
            </article>
          ) : (
            <EmptyState icon={<ListTree size={32} />} title="选择左侧大纲查看" hint="或新建一篇大纲文档" />
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-5">
            <Input value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true) }} className="max-w-xs" />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              序号
              <Input
                type="number"
                value={draft.order}
                onChange={(e) => { setDraft({ ...draft, order: Number(e.target.value) || 1 }); setDirty(true) }}
                className="w-20"
              />
            </label>
            {dirty && <span className="text-xs text-accent">未保存</span>}
            <div className="hidden flex-1 sm:block" />
            <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setDirty(false) }}>
              完成
            </Button>
            <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} />
            </Button>
            <Button variant="primary" size="sm" onClick={() => void save()} loading={saving}>
              保存
            </Button>
          </div>
          <div className="min-h-0 flex-1 p-4">
            <MarkdownEditor value={draft.content} onChange={(content) => { setDraft({ ...draft, content }); setDirty(true) }} scrollRef={outlineReaderRef} />
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
