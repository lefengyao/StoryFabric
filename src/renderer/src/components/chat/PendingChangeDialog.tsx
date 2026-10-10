/** 写变更确认弹窗：内容变更以行级 diff 展示；删除/恢复展示为只读上下文 + 结果说明 */
import { Check, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { diffLines } from 'diff'
import type { PendingChange } from '../../../../shared/types'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/modal'
import { pendingChangeView } from '../../lib/pendingChangeView'

export function PendingChangeDialog({
  change,
  onConfirm,
  open = true,
  onDefer
}: {
  change: PendingChange
  onConfirm: (approved: boolean, decision?: import('../../../../shared/api').AgentChangeDecision) => void | Promise<void>
  open?: boolean
  onDefer?: () => void
}): React.ReactElement {
  const view = pendingChangeView(change)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveHistory, setSaveHistory] = useState<boolean | null>(null)
  useEffect(() => { setSubmitting(false); setError(null); setSaveHistory(null) }, [change.id])
  const confirm = async (approved: boolean): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try { await onConfirm(approved, change.historyEligible && approved ? { saveHistory: saveHistory === true } : undefined) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setSubmitting(false) }
  }
  const isContentDiff = view.variant === 'create' || view.variant === 'update'
  const parts = useMemo(() => {
    if (!isContentDiff) return null
    try {
      return diffLines(change.beforeText || '', change.afterText || '')
    } catch {
      return null
    }
  }, [change, isContentDiff])

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next && !submitting) onDefer?.() }} title={change.title} description={view.caption} wide>
      {isContentDiff ? (
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-line bg-app p-3 font-mono text-xs leading-5">
          {!parts && <span className="text-muted">（无法生成差异预览）</span>}
          {parts?.map((p, i) => (
            <pre
              key={i}
              className={`whitespace-pre-wrap break-all ${
                p.added ? 'bg-accent/10 text-accent' : p.removed ? 'bg-danger/10 text-danger' : 'text-muted'
              }`}
            >
              {(p.added ? '+ ' : p.removed ? '- ' : '  ') + p.value}
            </pre>
          ))}
          {parts && parts.length === 1 && parts[0].added && !change.beforeText && <span className="text-faint">（新文件）</span>}
        </div>
      ) : (
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-line bg-app p-3">
          {view.outcome && (
            <div
              className={`mb-3 rounded-md px-3 py-2 text-xs ${
                view.variant === 'remove' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
              }`}
            >
              {view.outcome}
            </div>
          )}
          {change.beforeText ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted">{change.beforeText}</pre>
          ) : (
            <span className="text-faint">（无现有内容）</span>
          )}
        </div>
      )}
      {change.historyEligible && <fieldset className="mt-4 rounded-lg border border-line p-3 text-sm" disabled={submitting}>
        <legend className="px-1 font-medium">{change.historyRequired ? '确认恢复并保留保护版本' : '本次修改是否保存为长期版本？'}</legend>
        <p className="mb-2 text-xs text-muted">{change.historyRequired ? '恢复会保存当前内容的保护版本和恢复结果，所选历史原稿保持完整。' : '长期版本可在历史页面回看和恢复，每次选择仅用于本次修改。'}</p>
        <label className="mr-4 inline-flex items-center gap-2"><input type="radio" name={`history-${change.id}`} checked={saveHistory === true} onChange={() => setSaveHistory(true)} />{change.historyRequired ? '保留保护版本并恢复' : '保存为新版本'}</label>
        {!change.historyRequired && <label className="inline-flex items-center gap-2"><input type="radio" name={`history-${change.id}`} checked={saveHistory === false} onChange={() => setSaveHistory(false)} />只更新当前内容</label>}
      </fieldset>}
      <div className="mt-4 flex items-center justify-end gap-2">
        {error && <span role="alert" className="text-xs text-danger">{error}</span>}
        {onDefer && <Button variant="ghost" disabled={submitting} onClick={onDefer}>稍后审查</Button>}
        <Button variant="ghost" disabled={submitting} onClick={() => void confirm(false)}>
          <X size={14} /> 拒绝
        </Button>
        <Button variant="primary" loading={submitting} disabled={submitting || (change.historyEligible && saveHistory === null)} onClick={() => void confirm(true)}>
          <Check size={14} /> {view.confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
