import { ChevronDown, ChevronUp, MapPin, Plus, Trash2, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Markdown } from '../../components/markdown/Markdown'
import { Badge, Button, EmptyState, Field, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { splitDelimitedText } from '../../lib/delimitedInput'
import type { StoryEvent } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'

export function EventsPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const events = [...(summary?.events ?? [])].sort((a, b) => a.order - b.order)
  const chars = summary?.characters ?? []
  const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? '？'

  const [editing, setEditing] = useState<StoryEvent | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [tagsText, setTagsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const startNew = (): void => {
    setEditing({
      id: '',
      title: '',
      storyTime: '',
      order: (events.length ? Math.max(...events.map((e) => e.order)) : 0) + 1,
      location: '',
      tags: [],
      characterIds: [],
      prevIds: [],
      nextIds: [],
      content: ''
    })
    setTagsText('')
    setIsNew(true)
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    setSaving(true)
    try {
      await api.saveEvent({ ...editing, tags: splitDelimitedText(tagsText), id: editing.id || undefined })
      setEditing(null)
      setTagsText('')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!editing?.id) return
    await api.deleteEvent(editing.id)
    setConfirmDelete(false)
    setEditing(null)
    await refresh()
  }

  /** 移动事件在时间线上的顺序 */
  const moveOrder = async (e: StoryEvent, dir: -1 | 1): Promise<void> => {
    const idx = events.findIndex((x) => x.id === e.id)
    const swapWith = events[idx + dir]
    if (!swapWith || idx === -1) return
    const a = { ...e, order: swapWith.order }
    const b = { ...swapWith, order: e.order }
    await Promise.all([api.saveEvent(a), api.saveEvent(b)])
    await refresh()
  }

  const toggleChar = (id: string): void => {
    if (!editing) return
    const has = editing.characterIds.includes(id)
    setEditing({ ...editing, characterIds: has ? editing.characterIds.filter((x) => x !== id) : [...editing.characterIds, id] })
  }
  const toggleRef = (field: 'prevIds' | 'nextIds', id: string): void => {
    if (!editing) return
    const list = editing[field]
    const has = list.includes(id)
    setEditing({ ...editing, [field]: has ? list.filter((x) => x !== id) : [...list, id] })
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex items-center px-6 py-3">
          <span className="text-xs text-faint">按故事内时间排序 · 共 {events.length} 个事件</span>
          <div className="flex-1" />
          <Button size="sm" variant="primary" onClick={startNew}>
            <Plus size={13} /> 新增事件
          </Button>
        </div>

        {events.length === 0 ? (
          <EmptyState icon={<Waypoints size={32} />} title="事件脉络还是空的" hint="把关键情节记录成事件，串起因果链" />
        ) : (
          <div className="relative mx-auto max-w-3xl pb-10">
            {/* 时间线竖线 */}
            <div className="absolute left-[27px] top-2 bottom-2 w-px bg-line" />
            {events.map((e, i) => (
              <div key={e.id} className="relative pl-16 pr-6 py-3 group">
                <div className="absolute left-[19px] top-5 h-4 w-4 rounded-full border-2 border-accent bg-app" />
                <button onClick={() => { setEditing({ ...e }); setTagsText(e.tags.join('，')); setIsNew(false); setConfirmDelete(false) }} className="w-full cursor-pointer rounded-xl border border-line bg-panel p-4 text-left transition hover:border-accent hover:shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.storyTime && <Badge tone="accent">{e.storyTime}</Badge>}
                    <span className="text-sm font-semibold">{e.title}</span>
                    {e.location && (
                      <span className="flex items-center gap-0.5 text-xs text-faint">
                        <MapPin size={11} /> {e.location}
                      </span>
                    )}
                    {e.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                  {(e.characterIds.length > 0 || e.prevIds.length > 0 || e.nextIds.length > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {e.characterIds.length > 0 && <span>人物：{e.characterIds.map(nameOf).join('、')}</span>}
                      {e.prevIds.length > 0 && (
                        <span className="text-faint">
                          ↑ 前因：{e.prevIds.map((id) => events.find((x) => x.id === id)?.title ?? '？').join('、')}
                        </span>
                      )}
                      {e.nextIds.length > 0 && (
                        <span className="text-faint">
                          ↓ 后果：{e.nextIds.map((id) => events.find((x) => x.id === id)?.title ?? '？').join('、')}
                        </span>
                      )}
                    </div>
                  )}
                  {e.content && (
                    <div className="mt-2 text-xs text-muted line-clamp-2 opacity-80 [&_*]:!text-xs">
                      <Markdown text={e.content.replace(/[#*>`]/g, '').slice(0, 160)} />
                    </div>
                  )}
                </button>
                <div className="absolute right-2 top-4 flex flex-col opacity-0 group-hover:opacity-100 transition">
                  <button title="上移" onClick={() => void moveOrder(e, -1)} disabled={i === 0} className="p-0.5 text-faint hover:text-fg disabled:opacity-30 cursor-pointer">
                    <ChevronUp size={14} />
                  </button>
                  <button title="下移" onClick={() => void moveOrder(e, 1)} disabled={i === events.length - 1} className="p-0.5 text-faint hover:text-fg disabled:opacity-30 cursor-pointer">
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑侧栏 */}
      {editing && (
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-line p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{isNew ? '新增事件' : '编辑事件'}</span>
            {!isNew && (
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} /> 删除
              </Button>
            )}
          </div>
          <Field label="标题 *">
            <Input value={editing.title} onChange={(ev) => setEditing({ ...editing, title: ev.target.value })} placeholder="夺旗之夜" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="故事内时间">
              <Input value={editing.storyTime} onChange={(ev) => setEditing({ ...editing, storyTime: ev.target.value })} placeholder="第三年·春" />
            </Field>
            <Field label="地点">
              <Input value={editing.location} onChange={(ev) => setEditing({ ...editing, location: ev.target.value })} />
            </Field>
          </div>
          <Field label="标签（逗号分隔）">
            <Input value={tagsText} onChange={(ev) => setTagsText(ev.target.value)} />
          </Field>

          <Field label={`关联人物（${editing.characterIds.length}）`}>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto rounded-lg border border-line p-2">
              {chars.length === 0 && <span className="text-xs text-faint">尚无人物</span>}
              {chars.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleChar(c.id)}
                  className={`rounded-md px-2 py-1 text-xs transition cursor-pointer ${
                    editing.characterIds.includes(c.id) ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted hover:text-fg'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </Field>

          <Field label="前因事件（点击勾选）">
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto rounded-lg border border-line p-2">
              {events.filter((x) => x.id !== editing.id).length === 0 && <span className="text-xs text-faint">暂无其他事件</span>}
              {events
                .filter((x) => x.id !== editing.id)
                .map((x) => (
                  <button
                    key={x.id}
                    onClick={() => toggleRef('prevIds', x.id)}
                    className={`rounded-md px-2 py-1 text-xs transition cursor-pointer ${
                      editing.prevIds.includes(x.id) ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted hover:text-fg'
                    }`}
                  >
                    {x.title}
                  </button>
                ))}
            </div>
          </Field>

          <Field label="后果事件（点击勾选）">
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto rounded-lg border border-line p-2">
              {events
                .filter((x) => x.id !== editing.id)
                .map((x) => (
                  <button
                    key={x.id}
                    onClick={() => toggleRef('nextIds', x.id)}
                    className={`rounded-md px-2 py-1 text-xs transition cursor-pointer ${
                      editing.nextIds.includes(x.id) ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted hover:text-fg'
                    }`}
                  >
                    {x.title}
                  </button>
                ))}
            </div>
          </Field>

          <Field label="事件经过（Markdown）">
            <div className="h-48">
              <MarkdownEditor value={editing.content} onChange={(content) => setEditing({ ...editing, content })} />
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-1 pb-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!editing.title.trim()}>
              保存
            </Button>
          </div>
        </aside>
      )}

      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${editing?.title ?? ''}」？`}>
        <p className="text-sm text-muted">此操作不可撤销；其他事件的因果链引用将悬空。</p>
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
