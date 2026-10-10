import { AlignLeft, ArchiveRestore, Check, Copy, Download, FileImage, ListFilter, MoreHorizontal, Redo2, Save, Search, Sparkles, TextSelect, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChapterDoc, ChapterStatus, VolumeMeta } from '../../../../shared/types'
import { boxForChapterStatus } from '../../../../shared/chapterPlacement'
import { ActionPanel, actionPanelButtonClass } from '../../components/ui/ActionPanel'
import { Button, Input } from '../../components/ui/primitives'
import { CHAPTER_STATUS_LABEL, cn } from '../../lib/utils'

export function ChapterToolbar({ draft, volumes, dirty, saving, copied, sharingImage, canPolish, canDeAi, onChange, onSave, onFinish, onAi, onPolish, onDeAi, onSearch, onFormat, onEditWords, onUndo, onRedo, onSelectAll, onCopy, onExport, onShare, onMove, onDelete }: {
  draft: Partial<ChapterDoc>
  volumes: VolumeMeta[]
  dirty: boolean
  saving: boolean
  copied: boolean
  sharingImage: boolean
  canPolish: boolean
  canDeAi: boolean
  onChange: (patch: Partial<ChapterDoc>) => void
  onSave: () => void
  onFinish: () => void
  onAi: () => void
  onPolish: () => void
  onDeAi: () => void
  onSearch: () => void
  onFormat: () => void
  onEditWords: () => void
  onUndo: () => void
  onRedo: () => void
  onSelectAll: () => void
  onCopy: () => void
  onExport: () => void
  onShare: () => void
  onMove: () => void
  onDelete: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const pendingAction = useRef<(() => void) | null>(null)
  useEffect(() => setOpen(false), [draft.id])
  const run = (action: () => void): void => { pendingAction.current = action; setOpen(false) }
  const properties = (inPanel: boolean): React.ReactElement => (
    <div className={inPanel ? 'grid grid-cols-2 gap-3' : 'chapter-desktop-tools flex items-center gap-2'}>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
        {inPanel && <span>所属卷</span>}
        <select aria-label="所属卷" value={draft.volumeId ?? volumes[0]?.id ?? 'vol_default'} onChange={(e) => { const volume = volumes.find((v) => v.id === e.target.value); onChange({ volumeId: e.target.value, volume: volume?.title ?? draft.volume }) }} className="set-select min-w-0">
          {(volumes.length ? volumes : [{ id: 'vol_default', title: draft.volume ?? '第一卷', order: 1 }]).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
        {inPanel && <span>章节状态</span>}
        <select aria-label="章节状态" value={draft.status ?? 'draft'} onChange={(e) => { const status = e.target.value as ChapterStatus; onChange({ status, box: boxForChapterStatus(status) }) }} className="set-select min-w-0">
          <optgroup label="草稿箱">{(['draft', 'revised'] as const).map((s) => <option key={s} value={s}>{CHAPTER_STATUS_LABEL[s]}</option>)}</optgroup>
          <optgroup label="正文箱">{(['body', 'final'] as const).map((s) => <option key={s} value={s}>{CHAPTER_STATUS_LABEL[s]}</option>)}</optgroup>
        </select>
      </label>
      <label className={cn('flex gap-1 text-xs text-muted', inPanel ? 'flex-col' : 'items-center')}>
        序号<Input aria-label="章节序号" type="number" value={draft.order ?? 1} onChange={(e) => onChange({ order: Number(e.target.value) || 1 })} className={inPanel ? '' : 'w-16'} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
        {inPanel && <span>术语标注</span>}
        <Input aria-label="术语标注" value={(draft.terms ?? []).map((term) => term.term).join('，')} onChange={(e) => onChange({ terms: e.target.value.split(/[,，、\s]+/).map((term) => term.trim()).filter(Boolean).map((term) => ({ term })) })} placeholder="术语标注" className={inPanel ? '' : 'max-w-40'} title="用逗号分隔章节中的陌生名词" />
      </label>
    </div>
  )
  return (
    <div data-chapter-toolbar className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-5">
      <Input aria-label="章节标题" value={draft.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} className="chapter-title min-w-0 max-w-56" />
      {properties(false)}
      <div className="chapter-desktop-tools flex flex-1 items-center justify-end gap-1">
        {dirty && <span className="text-xs text-accent">未保存</span>}
        <Button variant="ghost" size="sm" onClick={onFinish}>完成</Button>
        <Button variant="ghost" size="sm" onClick={onAi}><Sparkles size={13} /> AI 续写</Button>
        <Button variant="ghost" size="sm" disabled={!canPolish} onClick={onPolish}>AI 润色</Button>
        <Button variant="ghost" size="sm" disabled={!canDeAi} onClick={onDeAi}>去 AI 风格</Button>
      </div>
      <div className="chapter-primary-actions ml-auto flex shrink-0 items-center gap-2">
        <ActionPanel open={open} onOpenChange={setOpen} title="章节工具" description={draft.title ?? '当前章节'} onCloseAutoFocus={(event) => { const action = pendingAction.current; if (action) { event.preventDefault(); pendingAction.current = null; action() } }} trigger={<Button variant="outline" size="icon" aria-label="章节更多操作" className="chapter-more"><MoreHorizontal size={18} /></Button>}>
          <section className="chapter-compact-tools mb-4" aria-label="章节信息">
            <h3 className="mb-3 text-xs font-semibold text-faint">章节信息</h3>
            {properties(true)}
          </section>
          <section className="chapter-compact-tools mb-4 border-t border-line pt-3" aria-label="AI 辅助">
            <h3 className="mb-1 text-xs font-semibold text-faint">AI 辅助</h3>
            <div className="grid grid-cols-2 gap-1">
              <button className={actionPanelButtonClass} onClick={() => run(onAi)}><Sparkles size={16} /> AI 续写</button>
              <button className={actionPanelButtonClass} disabled={!canPolish} onClick={() => run(onPolish)}><Sparkles size={16} /> AI 润色</button>
              <button className={actionPanelButtonClass} disabled={!canDeAi} onClick={() => run(onDeAi)}><Sparkles size={16} /> 去 AI 风格</button>
            </div>
          </section>
          <section aria-label="正文编辑">
            <h3 className="mb-1 text-xs font-semibold text-faint">正文编辑</h3>
            <div className="grid grid-cols-2 gap-1">
              <button className={actionPanelButtonClass} onClick={() => run(onSearch)}><Search size={16} /> 查找与替换</button>
              <button className={actionPanelButtonClass} onClick={() => run(onFormat)}><AlignLeft size={16} /> 一键排版</button>
              <button className={actionPanelButtonClass} onClick={() => run(onEditWords)}><ListFilter size={16} /> 编辑快捷词</button>
              <button className={actionPanelButtonClass} onClick={() => run(onSelectAll)}><TextSelect size={16} /> 全选正文</button>
              <button className={actionPanelButtonClass} onClick={() => run(onUndo)}><Undo2 size={16} /> 撤销</button>
              <button className={actionPanelButtonClass} onClick={() => run(onRedo)}><Redo2 size={16} /> 重做</button>
            </div>
          </section>
          <section className="mt-3 border-t border-line pt-3" aria-label="导出与分享">
            <h3 className="mb-1 text-xs font-semibold text-faint">导出与分享</h3>
            <div className="grid grid-cols-2 gap-1">
              <button className={actionPanelButtonClass} onClick={() => run(onCopy)}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? '已复制' : '复制全章'}</button>
              <button className={actionPanelButtonClass} onClick={() => run(onExport)}><Download size={16} /> 导出 Markdown</button>
              <button className={cn(actionPanelButtonClass, 'col-span-2')} disabled={sharingImage} onClick={() => run(onShare)}><FileImage size={16} /> {sharingImage ? '生成中…' : '生成长图分享'}</button>
            </div>
          </section>
          <section className="mt-3 border-t border-line pt-3" aria-label="章节管理">
            <div className="grid grid-cols-2 gap-1">
              {draft.id && <button className={actionPanelButtonClass} onClick={() => run(onMove)}><ArchiveRestore size={16} /> {draft.box === 'draft' ? '移入正文箱' : '移入草稿箱'}</button>}
              <button className={cn(actionPanelButtonClass, 'text-danger hover:text-danger')} onClick={() => run(onDelete)}><Trash2 size={16} /> 删除章节</button>
              <div className="chapter-compact-tools"><button className={actionPanelButtonClass} onClick={() => run(onFinish)}><Check size={16} /> 完成编辑</button></div>
            </div>
          </section>
        </ActionPanel>
        <Button variant="primary" size="sm" className="chapter-save" onClick={onSave} loading={saving}><Save size={14} /> 保存</Button>
      </div>
    </div>
  )
}
