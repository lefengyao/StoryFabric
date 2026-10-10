import { FolderHeart, Globe2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, Spinner } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { useWorkspace } from '../../stores/workspaceStore'
import type { MemoryScope, MemorySnapshot } from '../../../../shared/memory'

export function MemoryScopeEditor({
  scope,
  title,
  description
}: {
  scope: MemoryScope
  title: string
  description: string
}): React.ReactElement {
  const workspacePath = useWorkspace((state) => state.summary?.path)
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSnapshot(null)
    setDraft('')
    setError('')
    setSaved(false)
    void api.getMemory(scope).then((value) => {
      if (cancelled) return
      setSnapshot(value)
      setDraft(value.content)
    }).catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [scope, workspacePath])

  const update = async (patch: { enabled?: boolean; content?: string }): Promise<void> => {
    if (!snapshot || busy) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const next = await api.updateMemory(scope, { ...patch, baseRevision: snapshot.revision })
      setSnapshot(next)
      if (patch.content !== undefined) setDraft(next.content)
      setSaved(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent-soft p-2 text-accent">
            {scope === 'global' ? <Globe2 size={20} /> : <FolderHeart size={20} />}
          </div>
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
          </div>
        </div>
        {snapshot ? (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={snapshot.enabled}
              disabled={busy}
              onChange={(event) => void update({ enabled: event.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            {snapshot.enabled ? '已开启' : '未开启'}
          </label>
        ) : <Spinner />}
      </div>
      {snapshot && (
        <div className="mt-5">
          <label htmlFor={`${scope}-memory`} className="mb-2 block text-xs font-medium text-muted">记忆内容（Markdown）</label>
          <textarea
            id={`${scope}-memory`}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setSaved(false) }}
            maxLength={16000}
            rows={9}
            placeholder={scope === 'global' ? '- 我偏好简洁、直接的回答。' : '- 这个项目的叙事风格偏向克制。'}
            className="w-full resize-y rounded-lg border border-line bg-panel p-3 font-mono text-sm leading-6 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">关闭后保留文件，但智能体不会读取或写入这一层记忆。</span>
            <Button variant="primary" loading={busy} disabled={draft === snapshot.content} onClick={() => void update({ content: draft })}>保存记忆</Button>
          </div>
          {saved && <p role="status" className="mt-2 text-xs text-ok">已保存</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    </Card>
  )
}
