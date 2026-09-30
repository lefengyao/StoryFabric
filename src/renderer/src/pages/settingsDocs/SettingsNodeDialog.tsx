import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Markdown } from '../../components/markdown/Markdown'
import { Modal } from '../../components/ui/modal'
import { Button, Field, Input } from '../../components/ui/primitives'
import type { SettingsNodeDraft } from '../../lib/settingsNodeActions'
import type { SettingsTreeNode } from '../../lib/settingsTree'

interface FormProps {
  parentTitle: string
  value: SettingsNodeDraft
  onChange: (value: SettingsNodeDraft) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
}

export function SettingsChildNodeForm({ parentTitle, value, onChange, onSubmit, onCancel, busy }: FormProps): React.ReactElement {
  return (
    <form className="min-w-0 space-y-3 rounded-lg border border-line bg-elevated p-3" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <div className="text-sm font-medium">添加子节点</div>
      <p className="break-words text-xs text-muted">父节点：{parentTitle}</p>
      <Field label="标题">
        <Input aria-label="子节点标题" value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} disabled={busy} required autoFocus placeholder="子节点名称" />
      </Field>
      <Field label="简述" hint="显示在树状图中">
        <textarea aria-label="子节点简述" value={value.summary} onChange={(event) => onChange({ ...value, summary: event.target.value })} disabled={busy} rows={2} className="w-full rounded-lg border border-line bg-panel p-2 text-sm text-fg" />
      </Field>
      <Field label="详细内容" hint="支持 Markdown，可在节点弹窗、文字版和导出批注中查看">
        <textarea aria-label="子节点详细内容" value={value.content} onChange={(event) => onChange({ ...value, content: event.target.value })} disabled={busy} rows={8} className="w-full rounded-lg border border-line bg-panel p-2 text-sm text-fg" />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>取消</Button>
        <Button type="submit" size="sm" variant="primary" disabled={!value.title.trim()} loading={busy}>保存子节点</Button>
      </div>
    </form>
  )
}

interface Props {
  node: SettingsTreeNode
  content?: string
  loading: boolean
  onClose: () => void
  onAddChild: (parent: SettingsTreeNode, draft: SettingsNodeDraft) => Promise<void>
  onDelete: (node: SettingsTreeNode) => Promise<void>
}

export function SettingsNodeDialog({ node, content, loading, onClose, onAddChild, onDelete }: Props): React.ReactElement {
  const [action, setAction] = useState<'closed' | 'menu' | 'add' | 'delete'>('closed')
  const [draft, setDraft] = useState<SettingsNodeDraft>({ title: '', summary: '', content: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const operationId = useId()

  const perform = async (operation: () => Promise<void>, success?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await operation()
      if (success) setStatus(success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  return (
    <Modal open onOpenChange={(open) => { if (!open && !busy) onClose() }} title={node.title} description={node.summary} wide>
      <div className="space-y-3">
        <Button size="sm" variant="outline" aria-label="节点操作" aria-expanded={action !== 'closed'} aria-controls={operationId} disabled={busy} onClick={() => { setAction(action === 'closed' ? 'menu' : 'closed'); setError(null) }}>
          <MoreHorizontal size={14} /> 操作
        </Button>
        <div id={operationId}>
          {action === 'menu' && (
            <div className="flex flex-wrap gap-2" aria-label="节点操作选项">
              <Button size="sm" variant="outline" onClick={() => { setAction('add'); setStatus(null) }}><Plus size={13} /> 添加子节点</Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => { setAction('delete'); setStatus(null) }}><Trash2 size={13} /> 删除此节点</Button>
            </div>
          )}
          {action === 'add' && <SettingsChildNodeForm parentTitle={node.title} value={draft} onChange={setDraft} busy={busy} onCancel={() => { setAction('menu'); setError(null) }} onSubmit={() => void perform(async () => {
            await onAddChild(node, draft)
            setDraft({ title: '', summary: '', content: '' })
            setAction('closed')
          }, '已添加子节点')} />}
          {action === 'delete' && (
            <div className="space-y-3 rounded-lg border border-danger/30 bg-danger-soft p-3">
              <p className="break-words text-sm font-medium">删除「{node.title}」？</p>
              <p className="text-xs text-muted">{node.kind === 'tag' ? '只删除当前节点；它的子节点将接到上一级，保留各自的简述和详细内容。' : '该设定及其内部节点将移入回收站，独立的子设定会保留。'}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setAction('menu'); setError(null) }} disabled={busy}>取消</Button>
                <Button size="sm" variant="danger" loading={busy} onClick={() => void perform(async () => { await onDelete(node); onClose() })}>确认删除</Button>
              </div>
            </div>
          )}
        </div>
        {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
        {status && <p role="status" className="text-xs text-ok">{status}</p>}
      </div>
      <div className="mt-4 border-t border-line pt-4">
        {content ? <Markdown text={content} /> : <p className="text-sm text-muted">{loading ? '正在加载详细内容…' : '暂无详细内容'}</p>}
      </div>
    </Modal>
  )
}
