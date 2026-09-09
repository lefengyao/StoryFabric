/** 写变更确认弹窗：内容变更以行级 diff 展示；删除/恢复展示为只读上下文 + 结果说明 */
import { Check, X } from 'lucide-react'
import { useMemo } from 'react'
import { diffLines } from 'diff'
import type { PendingChange } from '../../../../shared/types'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/modal'
import { pendingChangeView } from '../../lib/pendingChangeView'

export function PendingChangeDialog({
  change,
  onConfirm
}: {
  change: PendingChange
  onConfirm: (approved: boolean) => void
}): React.ReactElement {
  const view = pendingChangeView(change)
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
    <Modal open onOpenChange={() => onConfirm(false)} title={change.title} description={view.caption} wide>
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
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => onConfirm(false)}>
          <X size={14} /> 拒绝
        </Button>
        <Button variant="primary" onClick={() => onConfirm(true)}>
          <Check size={14} /> 应用写入
        </Button>
      </div>
    </Modal>
  )
}
