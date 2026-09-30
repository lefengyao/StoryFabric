import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { availableTagParentNames } from '../../lib/settingsTree'

interface Props {
  tags: string[]
  tagParents?: Record<string, string>
  onChange: (tags: string[], tagParents: Record<string, string>) => void
}

export function TagHierarchyEditor({ tags, tagParents, onChange }: Props): React.ReactElement {
  const [newTag, setNewTag] = useState('')
  const candidate = newTag.trim()
  const duplicate = tags.includes(candidate)

  const addTag = (): void => {
    if (!candidate || duplicate) return
    onChange([...tags, candidate], { ...tagParents })
    setNewTag('')
  }

  const removeTag = (tag: string): void => {
    const nextParents = Object.fromEntries(Object.entries(tagParents ?? {}).filter(([child, parent]) => child !== tag && parent !== tag))
    onChange(tags.filter((item) => item !== tag), nextParents)
  }

  const setParent = (tag: string, parent: string): void => {
    const entries = Object.entries(tagParents ?? {}).filter(([child]) => child !== tag)
    if (parent) entries.push([tag, parent])
    const nextParents = Object.fromEntries(entries)
    onChange(tags, nextParents)
  }

  return (
    <section className="shrink-0 border-b border-line px-4 py-3 sm:px-5" aria-label="标签层级编辑">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">标签层级</h2>
        <p className="text-xs text-muted">未指定父标签时，标签直属当前设定；下方可逐级指定父标签。</p>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={newTag}
          onChange={(event) => setNewTag(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }}
          aria-label="新标签名称"
          placeholder="添加标签"
          className="h-9 min-w-0 max-w-64 flex-1 rounded-lg border border-line bg-panel px-2 text-sm outline-none focus:border-accent"
        />
        <button type="button" onClick={addTag} disabled={!candidate || duplicate} className="flex h-9 items-center gap-1 rounded-lg border border-line px-2 text-xs text-fg disabled:opacity-40"><Plus size={13} />添加</button>
        {duplicate && <span className="self-center text-xs text-coral">标签已存在</span>}
      </div>
      {tags.length > 0 && (
        <div className="mt-2 grid max-h-44 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
          {tags.map((tag) => (
            <div key={tag} className="flex min-w-0 items-center gap-2 rounded-lg bg-elevated px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs" title={tag}>{tag}</span>
              <select
                value={tagParents && Object.hasOwn(tagParents, tag) ? tagParents[tag] : ''}
                onChange={(event) => setParent(tag, event.target.value)}
                aria-label={`「${tag}」的父标签`}
                className="h-7 max-w-32 rounded border border-line bg-panel px-1 text-xs text-fg"
              >
                <option value="">当前设定</option>
                {availableTagParentNames(tags, tagParents, tag).map((parent) => <option key={parent} value={parent}>{parent}</option>)}
              </select>
              <button type="button" onClick={() => removeTag(tag)} aria-label={`删除标签 ${tag}`} className="rounded p-1 text-muted hover:text-danger"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
