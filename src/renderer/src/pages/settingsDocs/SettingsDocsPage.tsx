import { BookOpen, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Markdown } from '../../components/markdown/Markdown'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import type { SettingCategory, SettingDoc, SettingMeta } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'

export function SettingsDocsPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const [items, setItems] = useState<SettingMeta[]>(summary?.settings ?? [])
  const [selected, setSelected] = useState<SettingDoc | null>(null)
  const [draft, setDraft] = useState<SettingDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const reload = async (): Promise<void> => { setItems(await api.listSettings()); await refresh() }
  useEffect(() => { void reload() }, [])
  const open = async (item: SettingMeta): Promise<void> => { const full = await api.getSetting(item.id); setSelected(full); setDraft(full ? { ...full } : null); setDirty(false) }
  const create = (): void => { setSelected(null); setDraft({ id: '', title: '新设定', category: 'background', tags: [], content: '' }); setDirty(true) }
  const save = async (): Promise<void> => { if (!draft?.title.trim()) return; const saved = await api.saveSetting({ ...draft, id: draft.id || undefined }); setDraft(saved); setSelected(saved); setDirty(false); await reload() }
  const remove = async (): Promise<void> => { if (!selected) return; await api.deleteSetting(selected.id); setConfirmDelete(false); setDraft(null); setSelected(null); await reload() }

  return <div className="flex h-full flex-col sm:flex-row">
    <div className="flex h-52 w-full shrink-0 flex-col border-b border-line sm:h-auto sm:w-64 sm:border-b-0 sm:border-r">
      <div className="flex items-center justify-between p-3 pb-2"><span className="text-xs font-medium text-muted">设定资料</span><Button size="sm" variant="primary" onClick={create} title="新建设定"><Plus size={14} /></Button></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {(['background', 'other'] as SettingCategory[]).map((category) => <div key={category} className="mb-3"><div className="mb-1 px-1 text-[11px] font-semibold text-muted">{category === 'background' ? '背景设定' : '其他设定'}</div>{items.filter((item) => item.category === category).map((item) => <button key={item.id} onClick={() => void open(item)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${selected?.id === item.id ? 'bg-accent-soft text-accent' : 'hover:bg-elevated'}`}><BookOpen size={14} /><span className="truncate text-sm">{item.title}</span><Badge className="ml-auto">{item.tags.length}</Badge></button>)}</div>)}
      </div>
    </div>
    {!draft ? <div className="flex-1 overflow-y-auto">{selected ? <article className="mx-auto max-w-3xl p-8"><div className="mb-4 flex items-center justify-between"><div><h1 className="text-xl font-bold">{selected.title}</h1><Badge>{selected.category === 'background' ? '背景设定' : '其他设定'}</Badge></div><Button size="sm" onClick={() => setDraft({ ...selected })}>编辑</Button></div><Markdown text={selected.content} /></article> : <EmptyState icon={<BookOpen size={32} />} title="选择一条设定" hint="或新建设定资料" />}</div> : <div className="flex min-w-0 flex-1 flex-col"><div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-5"><Input value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true) }} className="max-w-xs" /><select value={draft.category} onChange={(e) => { setDraft({ ...draft, category: e.target.value as SettingCategory }); setDirty(true) }} className="h-9 rounded-lg border border-line bg-panel px-2 text-sm"><option value="background">背景设定</option><option value="other">其他设定</option></select>{dirty && <span className="text-xs text-accent">未保存</span>}<div className="flex-1" /><Button variant="ghost" size="sm" onClick={() => setDraft(null)}>完成</Button>{draft.id && <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /></Button>}<Button variant="primary" size="sm" onClick={() => void save()}><Save size={13} /> 保存</Button></div><div className="min-h-0 flex-1 p-4"><MarkdownEditor value={draft.content} onChange={(content) => { setDraft({ ...draft, content }); setDirty(true) }} /></div></div>}
    <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${selected?.title ?? ''}」？`}><p className="text-sm text-muted">条目将移入回收站。</p><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button><Button variant="danger" onClick={() => void remove()}>确认删除</Button></div></Modal>
  </div>
}
