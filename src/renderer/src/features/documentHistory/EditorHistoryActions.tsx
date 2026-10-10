import { History, Save } from 'lucide-react'
import { Button } from '../../components/ui/primitives'
import type { EditSessionState } from './editSession'

export function EditorHistoryActions({ state, onCapture, onHistory, onRetry }: {
  state: EditSessionState; onCapture: () => void; onHistory: () => void; onRetry: () => void
}): React.ReactElement {
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs sm:px-5">
    <Button size="sm" variant="outline" onClick={onCapture} loading={state.saving}><Save size={13} />保存为新版本</Button>
    <Button size="sm" variant="ghost" onClick={onHistory}><History size={13} />查看历史</Button>
    {state.lastHistoryAt !== null && <span className="text-faint">上次留存 {new Date(state.lastHistoryAt).toLocaleString()}</span>}
    {state.pendingHistory && <span className="text-muted">有待留存改动</span>}
    {state.error && <div role="alert" className="flex w-full items-center gap-2 text-danger"><span className="min-w-0 flex-1">留存未成功：{state.error}。本地草稿已保留。</span><Button size="sm" variant="outline" onClick={onRetry}>重试</Button></div>}
  </div>
}
