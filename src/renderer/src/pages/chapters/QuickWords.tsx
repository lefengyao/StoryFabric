import { AlignLeft, ChevronLeft, ChevronRight, ListFilter, Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal } from '../../components/ui/modal'
import { Button } from '../../components/ui/primitives'
import { cn } from '../../lib/utils'
import type { WritingToolsPreferences } from '../../../../shared/writingTools'

export function QuickWordRail({ words, activeWord, collapsed, onCollapse, onEdit, onFormat, onLocate }: {
  words: string[]; activeWord: string; collapsed: boolean; onCollapse: () => void; onEdit: () => void; onFormat: () => void; onLocate: (word: string) => void
}): React.ReactElement {
  return (
    <aside data-quick-word-rail data-collapsed={collapsed} aria-label="快捷词定位" className="quick-word-rail">
      <div className="flex shrink-0 items-center justify-between gap-1">
        {!collapsed && <span className="text-xs font-semibold text-muted">快捷词</span>}
        <button type="button" className="quick-word-icon" aria-label={collapsed ? '展开快捷词' : '收起快捷词'} onClick={onCollapse}><ListFilter size={16} /></button>
      </div>
      {!collapsed && <>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {words.length ? words.map((word) => <button type="button" key={word} title={word} aria-pressed={word === activeWord} onMouseDown={(event) => event.preventDefault()} onPointerDown={(event) => event.preventDefault()} onClick={() => onLocate(word)} className={cn('quick-word-item', word === activeWord && 'bg-accent-soft text-accent')}>{word}</button>) : <p className="px-1 py-3 text-xs leading-relaxed text-faint">添加常用词，点击即可定位正文。</p>}
        </div>
        <button type="button" className="quick-word-edit" aria-label="编辑快捷词" onClick={onEdit}><Pencil size={13} /><span>编辑</span></button>
        <button type="button" className="quick-word-edit" aria-label="一键排版" title="统一首行缩进与段间空行，可撤销" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={onFormat}><AlignLeft size={13} /><span>排版</span></button>
      </>}
    </aside>
  )
}

export function QuickWordResult({ word, count, index, onPrevious, onNext, onClose }: {
  word: string; count: number; index: number; onPrevious: () => void; onNext: () => void; onClose: () => void
}): React.ReactElement | null {
  if (!word) return null
  return <div data-quick-word-result className="flex min-h-9 shrink-0 items-center gap-2 border-b border-line px-2 text-xs">
    <span className="min-w-0 flex-1 truncate text-muted" title={word}>{word}</span>
    <span role="status" className="shrink-0 text-faint">{count ? `${index >= 0 ? index + 1 : '—'} / ${count}` : '正文中未找到'}</span>
    <button type="button" className="quick-word-icon" aria-label="上一个匹配" disabled={!count} onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()} onClick={onPrevious}><ChevronLeft size={16} /></button>
    <button type="button" className="quick-word-icon" aria-label="下一个匹配" disabled={!count} onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()} onClick={onNext}><ChevronRight size={16} /></button>
    <button type="button" className="quick-word-icon" aria-label="关闭快捷词定位" onClick={onClose}><X size={14} /></button>
  </div>
}

export function QuickWordEditor({ open, onOpenChange, preferences, suggestions, onSave }: {
  open: boolean; onOpenChange: (open: boolean) => void; preferences: WritingToolsPreferences; suggestions: string[]; onSave: (value: WritingToolsPreferences) => Promise<void>
}): React.ReactElement {
  const [custom, setCustom] = useState('')
  const [hidden, setHidden] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setCustom(preferences.customWords.join('\n')); setHidden(preferences.hiddenWords); setError('') } }, [open, preferences])
  const save = async (): Promise<void> => {
    setSaving(true); setError('')
    try { await onSave({ customWords: custom.split('\n'), hiddenWords: hidden }); onOpenChange(false) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  return <Modal open={open} onOpenChange={(value) => { if (!saving) onOpenChange(value) }} title="编辑快捷词" description="此工作区共用。点击左侧词语，可在当前章节中快速定位。">
    <label className="flex flex-col gap-2 text-sm text-muted">自定义词语
      <textarea aria-label="自定义快捷词" value={custom} onChange={(e) => setCustom(e.target.value)} rows={5} className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" placeholder="每行一个词语，例如角色名、地名或设定名" />
    </label>
    <p className="mt-1 text-xs text-faint">每行一个，最多 200 个；自定义词排在前面。</p>
    {suggestions.length > 0 && <fieldset className="mt-4"><legend className="mb-2 text-xs font-semibold text-muted">来自角色与设定</legend>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {suggestions.map((word) => <label key={word} className="flex max-w-full items-center gap-2 rounded-lg border border-line px-2 py-2 text-xs"><input type="checkbox" checked={!hidden.includes(word)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((value) => value !== word) : [...hidden, word])} /><span className="truncate" title={word}>{word}</span></label>)}
      </div>
    </fieldset>}
    {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button><Button loading={saving} onClick={() => void save()}>保存词表</Button></div>
  </Modal>
}
