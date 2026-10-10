import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/modal'

export function WorkspaceUpgradeDialogContent({ path, onAnswer }: { path: string; onAnswer: (approved: boolean) => void }): React.ReactElement {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6">此项目使用旧版项目格式（格式 4），需要升级到格式 5 后才能打开。升级前会备份将修改的原始文件，备份保存在项目的 <code>.storyfabric/format-backups</code> 文件夹中。</p>
      <div className="break-all rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-muted">{path}</div>
      <p className="text-xs leading-5 text-muted">升级后请使用支持新格式的织章版本打开。取消会保留原项目和当前工作区。</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onAnswer(false)}>取消</Button>
        <Button variant="primary" onClick={() => onAnswer(true)}>备份并升级</Button>
      </div>
    </div>
  )
}

export function useWorkspaceUpgradeConfirmation(): {
  confirmUpgrade: (path: string, signal?: AbortSignal) => Promise<boolean>
  cancelUpgrade: () => void
  upgradeDialog: React.ReactElement
} {
  const [path, setPath] = useState<string | null>(null)
  const pending = useRef<{ answer: (approved: boolean) => void; cleanup: () => void } | null>(null)
  const answer = useCallback((approved: boolean): void => {
    const request = pending.current
    pending.current = null
    request?.cleanup()
    request?.answer(approved)
    setPath(null)
  }, [])
  const cancelUpgrade = useCallback(() => answer(false), [answer])
  useEffect(() => () => {
    const request = pending.current
    pending.current = null
    request?.cleanup()
    request?.answer(false)
  }, [])
  const confirmUpgrade = useCallback((selectedPath: string, signal?: AbortSignal): Promise<boolean> => {
    answer(false)
    if (signal?.aborted) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const abort = (): void => answer(false)
      pending.current = { answer: resolve, cleanup: () => signal?.removeEventListener('abort', abort) }
      signal?.addEventListener('abort', abort, { once: true })
      setPath(selectedPath)
    })
  }, [answer])
  return {
    confirmUpgrade,
    cancelUpgrade,
    upgradeDialog: (
      <Modal open={path !== null} onOpenChange={(open) => { if (!open) answer(false) }} title="升级旧项目" description="确认后备份原文件并升级项目格式">
        {path !== null && <WorkspaceUpgradeDialogContent path={path} onAnswer={answer} />}
      </Modal>
    )
  }
}
