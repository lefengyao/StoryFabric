import { Markdown } from '../../components/markdown/Markdown'
import type { SettingsTreeGraph } from '../../lib/settingsTree'

interface Props {
  graph: SettingsTreeGraph
  detailsByNodeId: Record<string, string>
  loading: boolean
}

export function SettingsTreeTextView({ graph, detailsByNodeId, loading }: Props): React.ReactElement {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8" aria-label="设定树文字版">
      {loading && <p className="mb-4 text-xs text-muted" role="status">正在加载设定详细内容…</p>}
      <div className="mx-auto max-w-4xl space-y-4">
        {graph.nodes.map((node) => {
          const detail = detailsByNodeId[node.id] ?? node.content ?? ''
          return (
            <article key={node.id} className="min-w-0 border-l-2 border-[#f5b400] py-1 pl-4" style={{ marginLeft: Math.min(node.depth, 6) * 14 }}>
              <h2 className="text-sm font-semibold text-fg">{node.title}</h2>
              {node.summary && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{node.summary}</p>}
              {detail ? <div className="mt-2"><Markdown text={detail} /></div> : !loading && <p className="mt-2 text-xs text-faint">暂无详细内容</p>}
            </article>
          )
        })}
      </div>
    </div>
  )
}
