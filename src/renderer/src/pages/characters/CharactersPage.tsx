import { ChevronRight, Plus, Search, Trash2, UserRound, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Markdown } from '../../components/markdown/Markdown'
import { Badge, Button, EmptyState, Field, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { factionColor } from '../../lib/utils'
import type { CharacterDoc } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'

function emptyCharacter(): CharacterDoc {
  return { id: '', name: '', aliases: [], role: '', faction: '', gender: '', age: '', tags: [], summary: '', content: '' }
}

function parseTags(text: string): string[] {
  return text
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function CharactersPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CharacterDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const toggleGroup = (faction: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(faction)) next.delete(faction)
      else next.add(faction)
      return next
    })
  }

  const characters = summary?.characters ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return characters
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (c.faction ?? '').toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        c.summary.toLowerCase().includes(q)
    )
  }, [characters, query])

  /** 按阵营分组：具名阵营按出现顺序，未分组排最后 */
  const groups = useMemo<[string, CharacterDoc[]][]>(() => {
    const named = new Map<string, CharacterDoc[]>()
    const ungrouped: CharacterDoc[] = []
    for (const c of filtered) {
      const f = (c.faction ?? '').trim()
      if (f) {
        if (!named.has(f)) named.set(f, [])
        named.get(f)!.push(c)
      } else {
        ungrouped.push(c)
      }
    }
    const out: [string, CharacterDoc[]][] = [...named.entries()]
    if (ungrouped.length) out.push(['', ungrouped])
    return out
  }, [filtered])

  const tiers: [string, CharacterDoc[]][] = useMemo(() => [
    ['主要角色', filtered.filter((c) => c.tier === 'primary')],
    ['次要角色', filtered.filter((c) => c.tier !== 'primary')]
  ], [filtered])

  const factionPresets = useMemo(
    () => [...new Set(characters.map((c) => (c.faction ?? '').trim()).filter(Boolean))],
    [characters]
  )

  const selected = characters.find((c) => c.id === selectedId) ?? null

  const openEditor = (c: CharacterDoc | null): void => {
    if (draft && dirty && (c?.id ?? '') !== (draft.id ?? '') && !window.confirm('当前人物有未保存的修改，放弃并切换？')) return
    setSelectedId(c?.id ?? null)
    setDraft(c ? { ...c } : emptyCharacter())
    setDirty(false)
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      await api.saveCharacter({ ...draft, id: draft.id || undefined })
      await refresh()
      // 刷新后重新选中（新建场景 id 由后端生成，按名称匹配）
      const fresh = useWorkspace.getState().summary
      const target =
        (draft.id ? fresh?.characters.find((c) => c.id === draft.id) : undefined) ??
        fresh?.characters.find((c) => c.name === draft.name)
      setSelectedId(target?.id ?? null)
      setDraft(target ? { ...target } : null)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    await api.deleteCharacter(selectedId)
    setConfirmDelete(false)
    setSelectedId(null)
    setDraft(null)
    await refresh()
  }

  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* 左列：搜索 + 卡片列表 */}
      <div className="flex h-52 w-full shrink-0 flex-col border-b border-line sm:h-auto sm:w-72 sm:border-b-0 sm:border-r">
        <div className="flex items-center gap-2 p-3 pb-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索人物…" className="h-8 pl-8 text-xs" />
          </div>
          <Button size="sm" variant="primary" onClick={() => openEditor(null)} title="新建人物">
            <Plus size={14} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-3">
          {filtered.length === 0 && (
            <EmptyState icon={<UserRound size={28} />} title={query ? '没有匹配的人物' : '还没有人物'} hint="点击右上角 + 创建第一张人物卡" />
          )}
          {tiers.map(([tierLabel, tierChars]) => {
            if (!tierChars.length) return null
            const tierKey = tierLabel
            return <div key={tierKey} className="mb-3">
              <div className="mb-1 px-1 text-[11px] font-semibold text-muted">{tierLabel} <span className="text-faint">{tierChars.length}</span></div>
              {(() => {
                const grouped = new Map<string, CharacterDoc[]>()
                for (const c of tierChars) { const key = (c.faction ?? '').trim(); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key)!.push(c) }
                return [...grouped.entries()].map(([faction, chars]) => {
            const isCollapsed = collapsed.has(faction)
            return (
              <div key={faction || '_ungrouped'} className="mb-2">
                <button
                  onClick={() => toggleGroup(faction)}
                  className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition cursor-pointer hover:bg-elevated"
                >
                  <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                  <Users size={12} className="shrink-0" style={{ color: faction ? factionColor(faction) : undefined }} />
                  <span className="truncate text-xs font-semibold text-muted">{faction || '未分组'}</span>
                  <span className="ml-auto text-[10px] text-faint">{chars.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="mt-1 space-y-1.5">
                    {chars.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectedId !== c.id && openEditor(c)}
                        className={`w-full rounded-lg border p-2.5 text-left transition cursor-pointer ${
                          selectedId === c.id ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:bg-elevated'
                        } ${faction ? 'ml-4 w-[calc(100%-1rem)]' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: factionColor(c.faction ?? '') }} />
                          <span className="truncate text-sm font-medium">{c.name}</span>
                          {c.role && <Badge tone="accent">{c.role}</Badge>}
                        </div>
                        {c.summary && <div className="mt-0.5 truncate text-xs text-muted">{c.summary}</div>}
                        {c.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {c.tags.slice(0, 4).map((t) => (
                              <Badge key={t}>{t}</Badge>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
                })
              })()}
            </div>
          })}
        </div>
      </div>

      {/* 右侧：编辑器 */}
      {!draft ? (
        <div className="flex-1">
          {selected ? (
            <ReadOnlyCard c={selected} onEdit={() => openEditor(selected)} />
          ) : (
            <EmptyState icon={<UserRound size={32} />} title="选择左侧人物查看" hint="或创建新的人物卡" />
          )}
        </div>
      ) : (
        <CharacterForm
          draft={draft}
          dirty={dirty}
          saving={saving}
          factionPresets={factionPresets}
          onChange={(patch) => {
            setDraft({ ...draft, ...patch })
            setDirty(true)
          }}
          onSave={() => void save()}
          onDelete={() => setConfirmDelete(true)}
          onCancel={() => {
            setDraft(null)
            setDirty(false)
          }}
        />
      )}

      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${selected?.name ?? ''}」？`}>
        <p className="text-sm text-muted">将同时移除该人物相关的所有关系边与事件引用。此操作不可撤销。</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button variant="danger" onClick={() => void remove()}>
            <Trash2 size={14} /> 确认删除
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function ReadOnlyCard({ c, onEdit }: { c: CharacterDoc; onEdit: () => void }): React.ReactElement {
  return (
    <div className="mx-auto max-w-3xl p-6 overflow-y-auto h-full">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{c.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {c.role && <Badge tone="accent">{c.role}</Badge>}
            {c.faction && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: factionColor(c.faction) }} />
                <Badge>{c.faction}</Badge>
              </span>
            )}
            {c.gender && <Badge>{c.gender}</Badge>}
            {c.age && <Badge>{c.age}</Badge>}
            {c.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={onEdit}>
          编辑
        </Button>
      </div>
      {c.summary && <p className="mb-4 text-sm text-muted">{c.summary}</p>}
      <Markdown text={c.content} />
    </div>
  )
}

function CharacterForm({
  draft,
  dirty,
  saving,
  factionPresets,
  onChange,
  onSave,
  onDelete,
  onCancel
}: {
  draft: CharacterDoc
  dirty: boolean
  saving: boolean
  factionPresets: string[]
  onChange: (patch: Partial<CharacterDoc>) => void
  onSave: () => void
  onDelete: () => void
  onCancel: () => void
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span className="text-sm font-medium">{draft.id ? '编辑人物' : '新建人物'}</span>
        {dirty && <span className="text-xs text-accent">未保存</span>}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        {draft.id && (
          <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={onDelete}>
            <Trash2 size={13} /> 删除
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={onSave} loading={saving} disabled={!draft.name.trim()}>
          保存
        </Button>
      </div>

      <div className="grid grid-cols-1 flex-1 min-h-0 sm:grid-cols-[280px_1fr]">
        <div className="space-y-3.5 overflow-y-auto border-b border-line p-4 sm:border-b-0 sm:border-r">
          <Field label="姓名 *">
            <Input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="林晚" />
          </Field>
          <Field label="别名 / 称呼（逗号分隔）">
            <Input value={draft.aliases.join('，')} onChange={(e) => onChange({ aliases: parseTags(e.target.value) })} placeholder="晚晚" />
          </Field>
          <Field label="阵营 / 组织（可从已有选择）">
            <Input
              value={draft.faction ?? ''}
              onChange={(e) => onChange({ faction: e.target.value })}
              placeholder="如 星环学院 / 旧王朝"
              list="faction-presets"
            />
            <datalist id="faction-presets">
              {factionPresets.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="身份 / 定位">
              <Input value={draft.role} onChange={(e) => onChange({ role: e.target.value })} placeholder="主角" />
            </Field>
            <Field label="性别">
              <Input value={draft.gender} onChange={(e) => onChange({ gender: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="年龄">
              <Input value={draft.age} onChange={(e) => onChange({ age: e.target.value })} />
            </Field>
            <Field label="标签（逗号分隔）">
              <Input value={draft.tags.join('，')} onChange={(e) => onChange({ tags: parseTags(e.target.value) })} placeholder="法师, 学生" />
            </Field>
          </div>
          <Field label="一句话简介">
            <Input value={draft.summary} onChange={(e) => onChange({ summary: e.target.value })} placeholder="流落异乡的星图修复师" />
          </Field>
          <Field label="角色分类">
            <select value={draft.tier ?? 'secondary'} onChange={(e) => onChange({ tier: e.target.value as CharacterDoc['tier'] })} className="h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm">
              <option value="primary">主要角色</option>
              <option value="secondary">次要角色</option>
            </select>
          </Field>
        </div>
        <div className="flex min-h-0 flex-col p-4">
          <div className="mb-1.5 text-xs font-medium text-muted">详细设定（Markdown：外貌 / 性格 / 背景 / 成长弧光……）</div>
          <div className="min-h-0 flex-1">
            <MarkdownEditor value={draft.content} onChange={(content) => onChange({ content })} />
          </div>
        </div>
      </div>
    </div>
  )
}
