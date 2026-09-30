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
import { BookOpen, Download, GitBranch, List } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { SettingDoc, SettingMeta } from '../../../../shared/types'
import { Button, EmptyState } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { shareFiles } from '../../lib/shareFiles'
import { buildSettingsTree, SETTING_NODE_HEIGHT, SETTING_NODE_WIDTH, settingsTreeItems, settingsTreeRootIds, type SettingsTreeNode } from '../../lib/settingsTree'
import { settingsTreePngFile } from '../../lib/settingsTreeImage'
import { addSettingsChildNode, deleteSettingsNode, type SettingsNodeDraft } from '../../lib/settingsNodeActions'
import { SettingsTreeTextView } from './SettingsTreeTextView'
import { SettingsNodeDialog } from './SettingsNodeDialog'

interface SettingNodeData extends Record<string, unknown> {
  title: string
  summary?: string
  depth: number
  height: number
  warning?: string
}

type SettingFlowNode = Node<SettingNodeData, 'settingNode'>

function SettingNode({ data, selected }: NodeProps<SettingFlowNode>): React.ReactElement {
  return (
    <div
      className={`relative px-3 py-2.5 text-left ${data.depth === 0 ? 'rounded-lg bg-[#f5b400]' : 'border-b-2 border-[#f5b400] bg-panel/95'} ${selected ? 'ring-2 ring-[#cf9000]' : ''}`}
      style={{ width: SETTING_NODE_WIDTH, height: data.height }}
      title={data.warning}
    >
      <Handle type="target" position={Position.Left} className="!h-1 !w-1 !border-0 !bg-[#f5b400]" style={{ top: data.depth === 0 ? '50%' : 'calc(100% - 12px)' }} />
      <strong className="block truncate text-sm text-fg">{data.title}</strong>
      {data.summary && <p className="mt-1 whitespace-pre-wrap break-all text-xs leading-[18px] text-fg/75">{data.summary}</p>}
      {data.warning && <span className="mt-1 block truncate text-[10px] text-coral">{data.warning}</span>}
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !border-0 !bg-[#f5b400]" style={{ top: data.depth === 0 ? '50%' : 'calc(100% - 12px)' }} />
    </div>
  )
}

const nodeTypes = { settingNode: SettingNode }

interface Props {
  items: SettingMeta[]
  workspaceName: string
  onOpen: (item: SettingMeta) => void
  onChanged: (settingId: string, doc: SettingDoc | null) => void
  initialRootId?: string
}

function fileNamePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '设定'
}

export function SettingsTreeView({ items, workspaceName, onOpen, onChanged, initialRootId }: Props): React.ReactElement {
  const selectableItems = useMemo(() => settingsTreeItems(items), [items])
  const rootIds = useMemo(() => settingsTreeRootIds(items), [items])
  const rootIdSet = useMemo(() => new Set(rootIds), [rootIds])
  const [selectedRootId, setSelectedRootId] = useState<string | undefined>(() => initialRootId ?? rootIds[0] ?? selectableItems[0]?.id)
  const [mode, setMode] = useState<'chart' | 'text'>('chart')
  const [includeNotes, setIncludeNotes] = useState(true)
  const [detailsByNodeId, setDetailsByNodeId] = useState<Record<string, string>>({})
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  useEffect(() => {
    if (initialRootId) setSelectedRootId(initialRootId)
  }, [initialRootId])

  useEffect(() => {
    if (selectedRootId && items.some((item) => item.id === selectedRootId)) return
    setSelectedRootId(rootIds[0] ?? selectableItems[0]?.id)
  }, [items, rootIds, selectableItems, selectedRootId])

  const selectedItems = useMemo(() => settingsTreeItems(items, selectedRootId), [items, selectedRootId])
  const graph = useMemo(() => buildSettingsTree(selectedItems), [selectedItems])
  const activeNode = graph.nodes.find((node) => node.id === activeNodeId)
  const selectedItem = useMemo(() => items.find((item) => item.id === selectedRootId), [items, selectedRootId])
  const warningById = useMemo(() => new Map(graph.warnings.map((warning) => [warning.nodeId, warning.message])), [graph])
  const initialNodes = useMemo<SettingFlowNode[]>(() => graph.nodes.map((node) => ({
    id: node.id,
    type: 'settingNode',
    position: node.position,
    data: {
      title: node.title,
      summary: node.summary,
      depth: node.depth,
      height: node.height ?? SETTING_NODE_HEIGHT,
      warning: warningById.get(node.id)
    }
  })), [graph.nodes, warningById])
  const initialEdges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    ...edge,
    type: 'default',
    style: { stroke: '#f5b400', strokeWidth: 2.5 }
  })), [graph.edges])
  const [nodes, setNodes, onNodesChange] = useNodesState<SettingFlowNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setNodes(initialNodes); setEdges(initialEdges) }, [initialNodes, initialEdges, setNodes, setEdges])

  const loadSettingDetails = async (ids = graph.nodes.filter((node) => node.kind !== 'tag').map((node) => node.id)): Promise<Record<string, string>> => {
    const missing = ids.filter((id) => !Object.hasOwn(detailsByNodeId, id))
    if (missing.length === 0) return detailsByNodeId
    const entries = await Promise.all(missing.map(async (id) => {
      const doc = await api.getSetting(id)
      if (!doc) throw new Error(`未找到设定：${id}`)
      return [id, doc.content] as const
    }))
    const loaded = Object.fromEntries(entries)
    setDetailsByNodeId((previous) => ({ ...previous, ...loaded }))
    return { ...detailsByNodeId, ...loaded }
  }

  useEffect(() => {
    if (mode !== 'text' || graph.nodes.length === 0) return
    let active = true
    setLoadingDetails(true)
    void loadSettingDetails().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) }).finally(() => { if (active) setLoadingDetails(false) })
    return () => { active = false }
  }, [mode, graph])

  const openDetail = async (node: SettingsTreeNode): Promise<void> => {
    setActiveNodeId(node.id)
    if (node.kind === 'tag' || Object.hasOwn(detailsByNodeId, node.id)) return
    setLoadingDetails(true)
    try { await loadSettingDetails([node.id]) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoadingDetails(false) }
  }

  const addChild = async (parent: SettingsTreeNode, draft: SettingsNodeDraft): Promise<void> => {
    const doc = await addSettingsChildNode(api, parent, draft)
    setDetailsByNodeId((previous) => ({ ...previous, [doc.id]: doc.content }))
    setError(null)
    onChanged(doc.id, doc)
  }

  const deleteNode = async (node: SettingsTreeNode): Promise<void> => {
    const doc = await deleteSettingsNode(api, node)
    const settingId = node.kind === 'tag' ? node.settingId! : node.id
    setDetailsByNodeId((previous) => doc ? { ...previous, [settingId]: doc.content } : Object.fromEntries(Object.entries(previous).filter(([id]) => id !== settingId)))
    setError(null)
    onChanged(settingId, doc)
    setActiveNodeId(null)
  }

  const exportImage = async (): Promise<void> => {
    if (graph.nodes.length === 0) return
    setExporting(true)
    setError(null)
    try {
      const fileName = `${fileNamePart(workspaceName || 'StoryFabric')}-${fileNamePart(selectedItem?.title ?? '设定')}-设定图谱.png`
      const loaded = includeNotes ? await loadSettingDetails() : {}
      const file = await settingsTreePngFile(graph, fileName, { includeNotes, detailsByNodeId: loaded })
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
        <div className="flex rounded-md border border-line p-0.5">
          <button type="button" onClick={() => setMode('chart')} aria-pressed={mode === 'chart'} className={`rounded px-2 py-1 text-xs ${mode === 'chart' ? 'bg-[#f5b400] text-stone-900' : 'text-muted'}`}><GitBranch size={12} className="inline" /> 图</button>
          <button type="button" onClick={() => setMode('text')} aria-pressed={mode === 'text'} className={`rounded px-2 py-1 text-xs ${mode === 'text' ? 'bg-[#f5b400] text-stone-900' : 'text-muted'}`}><List size={12} className="inline" /> 文字版</button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { if (selectedItem) onOpen(selectedItem) }} disabled={!selectedItem} title="打开当前设定">
          <BookOpen size={13} /> 打开设定
        </Button>
        <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />导出详细批注</label>
        <Button size="sm" variant="outline" onClick={() => void exportImage()} disabled={graph.nodes.length === 0} loading={exporting}>
          <Download size={13} /> 导出图片
        </Button>
      </div>
      {error && <p className="border-b border-line bg-danger-soft px-4 py-2 text-xs text-danger" role="alert">{error}</p>}
      {graph.nodes.length === 0 ? (
        <EmptyState icon={<GitBranch size={32} />} title="还没有设定" hint="创建设定后即可查看横向树状图" />
      ) : mode === 'text' ? (
        <SettingsTreeTextView graph={graph} detailsByNodeId={detailsByNodeId} loading={loadingDetails} />
      ) : (
        <div className="min-h-0 min-w-0 flex-1">
          <ReactFlow<SettingFlowNode, Edge>
            key={selectedRootId ?? 'settings-tree'}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => { const target = graph.nodes.find((item) => item.id === node.id); if (target) void openDetail(target) }}
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
      {activeNode && <SettingsNodeDialog key={activeNode.id} node={activeNode} content={activeNode.kind === 'tag' ? activeNode.content : detailsByNodeId[activeNode.id]} loading={activeNode.kind !== 'tag' && loadingDetails} onClose={() => setActiveNodeId(null)} onAddChild={addChild} onDelete={deleteNode} />}
    </div>
  )
}
