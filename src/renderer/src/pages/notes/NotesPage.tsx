import { FileText, Pin, Plus, Save, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Markdown } from '../../components/markdown/Markdown'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import type { NoteDoc, NoteMeta } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'

export function NotesPage(): React.ReactElement {
  const refresh = useWorkspace((s) => s.refresh)
  const [items, setItems] = useState<NoteMeta[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<NoteDoc | null>(null)
  const [draft, setDraft] = useState<NoteDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const reload = async (): Promise<void> => { setItems(await api.listNotes()); await refresh() }
  useEffect(() => { void reload() }, [])
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? items.filter((item) => item.title.toLowerCase().includes(q) || item.tags.some((tag) => tag.toLowerCase().includes(q))) : items }, [items, query])
  const open = async (item: NoteMeta): Promise<void> => { const full = await api.getNote(item.id); setSelected(full); setDraft(full ? { ...full } : null); setDirty(false) }
  const create = (): void => { const now = Date.now(); setSelected(null); setDraft({ id: '', title: '新便签', tags: [], pinned: false, createdAt: now, updatedAt: now, content: '' }); setDirty(true) }
  const save = async (): Promise<void> => { if (!draft?.title.trim()) return; const saved = await api.saveNote({ ...draft, id: draft.id || undefined }); setSelected(saved); setDraft(saved); setDirty(false); await reload() }
  const remove = async (): Promise<void> => { if (!selected) return; await api.deleteNote(selected.id); setConfirmDelete(false); setSelected(null); setDraft(null); await reload() }
  return <div className="flex h-full flex-col sm:flex-row"><div className="flex h-52 w-full shrink-0 flex-col border-b border-line sm:h-auto sm:w-64 sm:border-b-0 sm:border-r"><div className="flex items-center gap-2 p-3 pb-2"><div className="relative flex-1"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索便签…" className="h-8 pl-8 text-xs" /></div><Button size="sm" variant="primary" onClick={create} title="新建便签"><Plus size={14} /></Button></div><div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{filtered.map((item) => <button key={item.id} onClick={() => void open(item)} className={`list-row flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left ${selected?.id === item.id ? 'bg-accent-soft text-accent' : 'hover:bg-elevated'}`}>{item.pinned ? <Pin size={13} className="shrink-0" /> : <FileText size={13} className="shrink-0" />}<span className="min-w-0 flex-1 truncate text-sm">{item.title}</span></button>)}{!filtered.length && <EmptyState icon={<FileText size={26} />} title="还没有便签" hint="记录灵感、待办或写作提醒" />}</div></div>{!draft ? <div className="flex-1 overflow-y-auto">{selected ? <article className="mx-auto max-w-3xl p-8"><div className="mb-4 flex items-center justify-between"><h1 className="text-xl font-bold">{selected.title}</h1><Button size="sm" onClick={() => setDraft({ ...selected })}>编辑</Button></div><Markdown text={selected.content} /></article> : <EmptyState icon={<FileText size={32} />} title="选择一条便签" hint="或新建便签" />}</div> : <div className="flex min-w-0 flex-1 flex-col"><div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-5"><Input value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true) }} className="max-w-xs" /><label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={draft.pinned} onChange={(e) => { setDraft({ ...draft, pinned: e.target.checked }); setDirty(true) }} />置顶</label>{dirty && <span className="text-xs text-accent">未保存</span>}<div className="flex-1" /><Button variant="ghost" size="sm" onClick={() => setDraft(null)}>完成</Button>{draft.id && <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /></Button>}<Button variant="primary" size="sm" onClick={() => void save()}><Save size={13} /> 保存</Button></div><div className="min-h-0 flex-1 p-4"><MarkdownEditor value={draft.content} onChange={(content) => { setDraft({ ...draft, content }); setDirty(true) }} /></div></div>}<Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${selected?.title ?? ''}」？`}><p className="text-sm text-muted">便签将移入回收站。</p><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button><Button variant="danger" onClick={() => void remove()}>确认删除</Button></div></Modal></div>
}
