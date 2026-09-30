import '@xyflow/react/dist/style.css'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import { BookOpen, Download, GitBranch } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { SettingMeta } from '../../../../shared/types'
import { Button, EmptyState } from '../../components/ui/primitives'
import { shareFiles } from '../../lib/shareFiles'
import { buildSettingsTree, SETTING_NODE_HEIGHT, SETTING_NODE_WIDTH, settingsTreeItems, settingsTreeRootIds } from '../../lib/settingsTree'
import { settingsTreePngFile } from '../../lib/settingsTreeImage'

interface SettingNodeData extends Record<string, unknown> {
  title: string
  category: string
  tagCount: number
  kind?: 'tag'
  warning?: string
}

type SettingFlowNode = Node<SettingNodeData, 'settingNode'>

function SettingNode({ data, selected }: NodeProps<SettingFlowNode>): React.ReactElement {
  return (
    <div
      className={`rounded-xl border-2 px-3 py-2.5 text-left shadow-sm ${data.kind === 'tag' ? 'bg-accent-soft' : 'bg-panel'} ${selected ? 'border-accent' : data.warning ? 'border-coral' : 'border-line'}`}
      style={{ width: SETTING_NODE_WIDTH, height: SETTING_NODE_HEIGHT }}
      title={data.warning}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent" />
      <strong className="block truncate text-sm text-fg">{data.title}</strong>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        {data.kind === 'tag' ? <span>标签</span> : <><span>{data.category}</span><span>·</span><span>{data.tagCount} 个标签</span></>}
      </div>
      {data.warning && <span className="mt-1 block truncate text-[10px] text-coral">{data.warning}</span>}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent" />
    </div>
  )
}

const nodeTypes = { settingNode: SettingNode }

interface Props {
  items: SettingMeta[]
  workspaceName: string
  onOpen: (item: SettingMeta) => void
  initialRootId?: string
}

function fileNamePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '设定'
}

export function SettingsTreeView({ items, workspaceName, onOpen, initialRootId }: Props): React.ReactElement {
  const selectableItems = useMemo(() => settingsTreeItems(items), [items])
  const rootIds = useMemo(() => settingsTreeRootIds(items), [items])
  const rootIdSet = useMemo(() => new Set(rootIds), [rootIds])
  const [selectedRootId, setSelectedRootId] = useState<string | undefined>(() => initialRootId ?? rootIds[0] ?? selectableItems[0]?.id)

  useEffect(() => {
    if (initialRootId && items.some((item) => item.id === initialRootId)) setSelectedRootId(initialRootId)
  }, [initialRootId, items])

  useEffect(() => {
    if (selectedRootId && items.some((item) => item.id === selectedRootId)) return
    setSelectedRootId(rootIds[0] ?? selectableItems[0]?.id)
  }, [items, rootIds, selectableItems, selectedRootId])

  const selectedItems = useMemo(() => settingsTreeItems(items, selectedRootId), [items, selectedRootId])
  const graph = useMemo(() => buildSettingsTree(selectedItems), [selectedItems])
  const selectedItem = useMemo(() => items.find((item) => item.id === selectedRootId), [items, selectedRootId])
  const warningById = useMemo(() => new Map(graph.warnings.map((warning) => [warning.nodeId, warning.message])), [graph])
  const initialNodes = useMemo<SettingFlowNode[]>(() => graph.nodes.map((node) => ({
    id: node.id,
    type: 'settingNode',
    position: node.position,
    data: {
      title: node.title,
      category: node.category === 'background' ? '背景设定' : '其他设定',
      tagCount: node.tags.length,
      kind: node.kind,
      warning: warningById.get(node.id)
    }
  })), [graph.nodes, warningById])
  const initialEdges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    style: { stroke: 'var(--accent)', strokeWidth: 2 }
  })), [graph.edges])
  const [nodes, setNodes, onNodesChange] = useNodesState<SettingFlowNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setNodes(initialNodes); setEdges(initialEdges) }, [initialNodes, initialEdges, setNodes, setEdges])

  const exportImage = async (): Promise<void> => {
    if (graph.nodes.length === 0) return
    setExporting(true)
    setError(null)
    try {
      const fileName = `${fileNamePart(workspaceName || 'StoryFabric')}-${fileNamePart(selectedItem?.title ?? '设定')}-设定图谱.png`
      const file = await settingsTreePngFile(graph, fileName)
      await shareFiles([file], '设定图谱', '分享设定图谱')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="shrink-0">当前设定</span>
          <select
            value={selectedRootId ?? ''}
            onChange={(event) => setSelectedRootId(event.target.value || undefined)}
            className="h-8 min-w-0 max-w-64 rounded-md border border-line bg-panel px-2 text-xs text-fg"
            aria-label="选择图表根节点"
            disabled={selectableItems.length === 0}
          >
            {selectableItems.map((item) => <option key={item.id} value={item.id}>{item.title}{rootIdSet.has(item.id) ? ' · 根节点' : ''}</option>)}
          </select>
        </label>
        <span className="text-xs text-muted">{selectedItems.length} 条设定 · {graph.nodes.length - selectedItems.length} 个标签 · {graph.edges.length} 条父子关系</span>
        {graph.warnings.length > 0 && <span className="text-xs text-coral">{graph.warnings.length} 条关系需要检查</span>}
        {graph.nodes.length === 1 && selectableItems.length > 1 && <span className="text-xs text-faint">当前子树暂无父子关系，可在列表模式设置父级</span>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => { if (selectedItem) onOpen(selectedItem) }} disabled={!selectedItem} title="打开当前设定">
          <BookOpen size={13} /> 打开设定
        </Button>
        <Button size="sm" variant="outline" onClick={() => void exportImage()} disabled={graph.nodes.length === 0} loading={exporting}>
          <Download size={13} /> 导出图片
        </Button>
      </div>
      {error && <p className="border-b border-line bg-danger-soft px-4 py-2 text-xs text-danger" role="alert">{error}</p>}
      {graph.nodes.length === 0 ? (
        <EmptyState icon={<GitBranch size={32} />} title="还没有设定" hint="创建设定后即可查看横向树状图" />
      ) : (
        <div className="min-h-0 min-w-0 flex-1">
          <ReactFlow<SettingFlowNode, Edge>
            key={selectedRootId ?? 'settings-tree'}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => {
              if (node.data.kind !== 'tag') setSelectedRootId(node.id)
            }}
            fitView
            nodesDraggable={false}
            deleteKeyCode={null}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={28} color="var(--line)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </div>
  )
}
