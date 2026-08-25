/** 写变更确认弹窗：以行级 diff 展示 before/after */
import { Check, X } from 'lucide-react'
import { useMemo } from 'react'
import { diffLines } from 'diff'
import type { PendingChange } from '../../../../shared/types'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/modal'
import { ENTITY_KIND_LABEL } from '../../lib/utils'

export function PendingChangeDialog({
  change,
  onConfirm
}: {
  change: PendingChange
  onConfirm: (approved: boolean) => void
}): React.ReactElement {
  const parts = useMemo(() => {
    try {
      return diffLines(change.beforeText || '', change.afterText || '')
    } catch {
      return null
    }
  }, [change])

  return (
    <Modal
      open
      onOpenChange={() => onConfirm(false)}
      title={change.title}
      description={`智能体请求${change.beforeText ? '更新' : '新建'}${ENTITY_KIND_LABEL[change.entityKind] ?? '实体'} —— 确认后才会写入工作区`}
      wide
    >
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
        {parts && parts.length === 1 && parts[0].added && !change.beforeText && (
          <span className="text-faint">（新文件）</span>
        )}
      </div>
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
