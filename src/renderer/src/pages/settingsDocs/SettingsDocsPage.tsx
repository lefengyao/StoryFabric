import { BookOpen, GitBranch, List, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Markdown } from '../../components/markdown/Markdown'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { availableParentIds } from '../../lib/settingsTree'
import type { SettingCategory, SettingDoc, SettingMeta } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'
import { SettingsTreeView } from './SettingsTreeView'
import { TagHierarchyEditor } from './TagHierarchyEditor'

export function SettingsDocsPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const [items, setItems] = useState<SettingMeta[]>(summary?.settings ?? [])
  const [selected, setSelected] = useState<SettingDoc | null>(null)
  const [draft, setDraft] = useState<SettingDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [view, setView] = useState<'list' | 'tree'>('list')
  const [error, setError] = useState<string | null>(null)
  const parentIds = useMemo(() => availableParentIds(items, draft?.id), [items, draft?.id])
  const excludedParent = draft?.parentId && !parentIds.includes(draft.parentId)
    ? items.find((item) => item.id === draft.parentId)
    : undefined

  const reload = async (): Promise<void> => { setItems(await api.listSettings()); await refresh() }
  useEffect(() => { void reload().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))) }, [])

  const open = async (item: SettingMeta): Promise<void> => {
    if (dirty && !window.confirm('当前设定有未保存的修改，放弃后打开其他设定？')) return
    try {
      const full = await api.getSetting(item.id)
      setSelected(full)
      setDraft(full ? { ...full } : null)
      setDirty(false)
      setView('list')
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const create = (): void => {
    if (dirty && !window.confirm('当前设定有未保存的修改，放弃后新建设定？')) return
    setSelected(null)
    setDraft({ id: '', title: '新设定', summary: '', category: 'background', tags: [], content: '' })
    setDirty(true)
    setView('list')
    setError(null)
  }

  const save = async (): Promise<void> => {
    if (!draft?.title.trim()) return
    try {
      const saved = await api.saveSetting({ ...draft, id: draft.id || undefined })
      setDraft(saved)
      setSelected(saved)
      setDirty(false)
      setError(null)
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    try {
      await api.deleteSetting(selected.id)
      setConfirmDelete(false)
      setDraft(null)
      setSelected(null)
      setDirty(false)
      setError(null)
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const showTree = (): void => {
    if (dirty && !window.confirm('当前设定有未保存的修改，放弃后查看图表？')) return
    setDraft(null)
    setDirty(false)
    setView('tree')
  }

  const onTreeChanged = (id: string, doc: SettingDoc | null): void => {
    setError(null)
    if (doc) {
      const { content: _content, ...meta } = doc
      setItems((previous) => previous.map((item) => item.id === id ? meta : item))
    } else { setItems((previous) => previous.filter((item) => item.id !== id)) }
    if (selected?.id === id) { setSelected(doc); setDraft(null); setDirty(false) }
    void refresh().catch((cause) => setError(`节点已保存，刷新项目失败：${cause instanceof Error ? cause.message : String(cause)}`))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
        <div className="flex rounded-lg border border-line p-0.5">
          <button type="button" onClick={() => setView('list')} className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${view === 'list' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}`}><List size={13} /> 列表</button>
          <button type="button" onClick={showTree} className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${view === 'tree' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}`}><GitBranch size={13} /> 图表</button>
        </div>
        <span className="text-xs text-faint">{items.length} 条设定</span>
        <div className="flex-1" />
        <Button size="sm" variant="primary" onClick={create} title="新建设定"><Plus size={14} /> 新建</Button>
      </div>
      {error && <p className="shrink-0 border-b border-line bg-danger-soft px-4 py-2 text-xs text-danger" role="alert">{error}</p>}
      {view === 'tree' ? (
        <SettingsTreeView items={items} workspaceName={summary?.name ?? 'StoryFabric'} initialRootId={selected?.id} onOpen={(item) => { void open(item) }} onChanged={onTreeChanged} />
      ) : (
        <div data-android-document-layout className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div data-android-list-pane className="flex h-52 w-full shrink-0 flex-col border-b border-line sm:h-auto sm:w-64 sm:border-b-0 sm:border-r">
            <div className="flex items-center justify-between p-3 pb-2"><span className="text-xs font-medium text-muted">设定资料</span><Button size="sm" variant="primary" onClick={create} title="新建设定"><Plus size={14} /></Button></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {(['background', 'other'] as SettingCategory[]).map((category) => (
                <div key={category} className="mb-3">
                  <div className="mb-1 px-1 text-[11px] font-semibold text-muted">{category === 'background' ? '背景设定' : '其他设定'}</div>
                  {items.filter((item) => item.category === category).map((item) => (
                    <button key={item.id} onClick={() => void open(item)} className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left ${selected?.id === item.id ? 'bg-accent-soft text-accent' : 'hover:bg-elevated'}`}>
                      <BookOpen size={14} className="shrink-0" /><span className="min-w-0 flex-1 truncate text-sm">{item.title}</span><Badge className="ml-auto shrink-0">{item.tags.length}</Badge>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {!draft ? (
            <div className="min-w-0 flex-1 overflow-y-auto">
              {selected ? <article className="mx-auto max-w-3xl p-8"><div className="mb-4 flex items-center justify-between gap-3"><div><h1 className="text-xl font-bold">{selected.title}</h1><Badge>{selected.category === 'background' ? '背景设定' : '其他设定'}</Badge></div><Button size="sm" onClick={() => setDraft({ ...selected })}>编辑</Button></div><Markdown text={selected.content} /></article> : <EmptyState icon={<BookOpen size={32} />} title="选择一条设定" hint="或新建设定资料" />}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-5">
                <Input value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setDirty(true) }} className="max-w-xs" aria-label="设定标题" />
                <select value={draft.category} onChange={(event) => { setDraft({ ...draft, category: event.target.value as SettingCategory }); setDirty(true) }} className="h-9 rounded-lg border border-line bg-panel px-2 text-sm" aria-label="设定类别"><option value="background">背景设定</option><option value="other">其他设定</option></select>
                <label className="flex items-center gap-1 text-xs text-muted">父级设定
                  <select value={draft.parentId ?? ''} onChange={(event) => { setDraft({ ...draft, parentId: event.target.value }); setDirty(true) }} className="h-9 max-w-44 rounded-lg border border-line bg-panel px-2 text-sm text-fg" aria-label="父级设定">
                    <option value="">根节点</option>
                    {draft.parentId && !items.some((item) => item.id === draft.parentId) && <option value={draft.parentId}>缺失父级：{draft.parentId}</option>}
                    {excludedParent && <option value={excludedParent.id} disabled>循环父级：{excludedParent.title}</option>}
                    {parentIds.map((id) => { const item = items.find((entry) => entry.id === id); return item ? <option key={id} value={id}>{item.title}</option> : null })}
                  </select>
                </label>
                {dirty && <span className="text-xs text-accent">未保存</span>}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setDirty(false) }}>完成</Button>
                {draft.id && <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /></Button>}
                <Button variant="primary" size="sm" onClick={() => void save()}><Save size={13} /> 保存</Button>
              </div>
              <div className="shrink-0 border-b border-line px-4 py-3 sm:px-5"><label className="block text-xs text-muted">设定简述<textarea value={draft.summary ?? ''} onChange={(event) => { setDraft({ ...draft, summary: event.target.value }); setDirty(true) }} rows={2} className="mt-1 w-full rounded-lg border border-line bg-panel p-2 text-sm text-fg" placeholder="图表中显示的简短说明" /></label></div>
              <TagHierarchyEditor key={draft.id || 'new'} tags={draft.tags} tagParents={draft.tagParents} tagDetails={draft.tagDetails} onChange={(tags, tagParents, tagDetails) => { setDraft({ ...draft, tags, tagParents, tagDetails }); setDirty(true) }} />
              <div className="min-h-0 flex-1 p-4"><div className="mb-2 text-xs text-muted">设定详细内容</div><MarkdownEditor value={draft.content} onChange={(content) => { setDraft({ ...draft, content }); setDirty(true) }} /></div>
            </div>
          )}
        </div>
      )}
      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${selected?.title ?? ''}」？`}><p className="text-sm text-muted">条目将移入回收站。</p><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button><Button variant="danger" onClick={() => void remove()}>确认删除</Button></div></Modal>
    </div>
  )
}
