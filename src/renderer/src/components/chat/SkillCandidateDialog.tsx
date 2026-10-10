import { useState } from 'react'
import type { SkillCandidate, SkillCandidateAction } from '../../../../shared/agentQuestions'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/modal'

export function SkillCandidateDialog({
  candidate,
  open,
  onClose,
  onResolve
}: {
  candidate: SkillCandidate | null
  open: boolean
  onClose: () => void
  onResolve: (action: SkillCandidateAction) => Promise<void>
}): React.ReactElement | null {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<SkillCandidateAction | null>(null)

  if (!candidate) return null
  const manifest = candidate.package.manifest

  const resolve = async (action: SkillCandidateAction): Promise<void> => {
    setSubmitting(action)
    setError(null)
    try {
      await onResolve(action)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose() }} title={`Skill 候选：${manifest.name}`} description={candidate.reason} wide>
      <div className="space-y-4 text-sm">
        <div className="grid gap-2 rounded-lg border border-line bg-app/40 p-3 sm:grid-cols-2">
          <div><span className="text-muted">标识：</span><code>{manifest.id}</code></div>
          <div><span className="text-muted">版本：</span><code>{manifest.version}</code></div>
          <div><span className="text-muted">作者：</span>{manifest.author}</div>
          <div><span className="text-muted">许可：</span>{manifest.license}</div>
        </div>
        <p className="leading-6 text-muted">{manifest.description}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 text-xs font-medium text-fg">包含 Skill</div>
            <ul className="space-y-1 text-xs text-muted">
              {manifest.skills.length ? manifest.skills.map((item) => <li key={item.id}>{item.id} · {item.path}</li>) : <li>无</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 text-xs font-medium text-fg">包含规则集</div>
            <ul className="space-y-1 text-xs text-muted">
              {manifest.ruleSets.length ? manifest.ruleSets.map((item) => <li key={item.id}>{item.id} · {item.path}</li>) : <li>无</li>}
            </ul>
          </div>
        </div>
        {error && <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting !== null}>稍后处理</Button>
          <Button variant="danger" onClick={() => void resolve('reject')} loading={submitting === 'reject'}>拒绝</Button>
          <Button variant="outline" onClick={() => void resolve('install')} loading={submitting === 'install'}>仅安装</Button>
          <Button variant="primary" onClick={() => void resolve('install-enable')} loading={submitting === 'install-enable'}>安装并启用</Button>
        </div>
      </div>
    </Modal>
  )
}

