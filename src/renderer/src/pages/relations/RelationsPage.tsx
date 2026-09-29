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
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { seedPosition } from '../../lib/graphSeed'
import { Network, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, EmptyState, Field, Input } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { cn, factionColor } from '../../lib/utils'
import type { CharacterDoc, Relationship } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'

const REL_TYPE_PRESETS = ['亲属', '恋人', '朋友', '敌对', '师徒', '同僚', '陌生人']

const REL_SELECT_CLS =
  'h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none focus:border-accent cursor-pointer'

/* ---------------- 图谱节点 ---------------- */

type CharNodeData = { name: string; role: string; faction: string; ringColor: string }

function CharNode({ data, selected }: NodeProps<Node<CharNodeData>>): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-1 cursor-grab" title={data.faction ? `阵营：${data.faction}` : undefined}>
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full border-[3px] text-lg font-semibold shadow-md transition-colors',
          selected ? 'bg-accent text-accent-fg' : 'bg-panel text-fg'
        )}
        style={{ borderColor: selected ? undefined : data.ringColor || 'var(--line)' }}
      >
        {(data.name || '?').slice(0, 1)}
      </div>
      <div className="max-w-24 truncate rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs shadow-sm">{data.name}</div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

const nodeTypes = { charNode: CharNode }

type Position2D = { x: number; y: number }
type RememberedPos = Position2D & { id: string }

function positionsOf(nodes: Node<CharNodeData>[]): Record<string, Position2D> {
  const map: Record<string, Position2D> = {}
  for (const n of nodes) map[n.id] = { x: n.position.x, y: n.position.y }
  return map
}

/**
 * 生成图谱：先用力导向算一版，再用已保存/当前画布上的坐标覆盖，
 * 保证「新增人物参与布局、老人物位置不漂移」。
 */
function buildGraph(
  chars: CharacterDoc[],
  rels: Relationship[],
  remembered: RememberedPos[]
): { nodes: Node<CharNodeData>[]; edges: Edge[] } {
  const rememberedById = new Map(remembered.map((p) => [p.id, p]))
  const charById = new Map(chars.map((c) => [c.id, c]))
  // 有记忆坐标的节点用 fx/fy 钉住，让新节点围绕真实位置排布；其余按 id 播种，避免每次重建都乱跳
  const simNodes = chars.map((c) => {
    const fixed = rememberedById.get(c.id)
    const seed = seedPosition(c.id)
    return { id: c.id, x: fixed?.x ?? seed.x, y: fixed?.y ?? seed.y, fx: fixed?.x, fy: fixed?.y }
  })
  const simLinks = rels
    .filter((r) => charById.has(r.fromId) && charById.has(r.toId))
    .map((r) => ({ source: r.fromId, target: r.toId }))
  const sim = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-420))
    .force(
      'link',
      forceLink(simLinks)
        .id((d) => (d as { id: string }).id)
        .distance(170)
        .strength(0.5)
    )
    .force('center', forceCenter(0, 0))
    .stop()
  sim.tick(220)

  const nodes: Node<CharNodeData>[] = simNodes.map((n) => {
    const c = charById.get(n.id)
    const rememberedPos = rememberedById.get(n.id)
    return {
      id: n.id,
      type: 'charNode',
      position: rememberedPos ? { x: rememberedPos.x, y: rememberedPos.y } : { x: n.x, y: n.y },
      data: { name: c?.name ?? '?', role: c?.role ?? '', faction: c?.faction ?? '', ringColor: factionColor(c?.faction) },
      draggable: true
    }
  })
  const edges: Edge[] = rels.map((r) => ({
    id: r.id,
    source: r.fromId,
    target: r.toId,
    label: [r.type, r.label].filter(Boolean).join('·'),
    animated: false,
    labelStyle: { fontSize: 11, fill: 'var(--muted)' },
    labelBgStyle: { fill: 'var(--panel)' },
    style: { stroke: 'var(--faint)', strokeWidth: 1.5 },
    ...(r.directed ? { markerEnd: { type: 'arrowclosed' as const, color: 'var(--faint)' } } : {})
  }))
  return { nodes, edges }
}

/* ---------------- 页面 ---------------- */

export function RelationsPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [editing, setEditing] = useState<Relationship | null>(null)
  const [isNew, setIsNew] = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CharNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const chars = summary?.characters ?? []
  const rels = useMemo(() => [...(summary?.relationships ?? [])].sort((a, b) => a.id.localeCompare(b.id)), [summary?.relationships])
  const nameOf = (id: string): string => chars.find((c) => c.id === id)?.name ?? '？'

  /* 已记忆的坐标：磁盘布局 + 当前画布位置（后者优先） */
  const savedLayoutRef = useRef<Record<string, Position2D>>({})
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const rebuild = (): void => {
    const remembered: RememberedPos[] = Object.entries({ ...savedLayoutRef.current, ...positionsOf(nodesRef.current) }).map(
      ([id, p]) => ({ id, x: p.x, y: p.y })
    )
    const built = buildGraph(chars, rels, remembered)
    setNodes(built.nodes)
    setEdges(built.edges)
  }

  /* 工作区切换时载入磁盘布局；人物/关系变化时重建（保留已记忆坐标） */
  useEffect(() => {
    let cancelled = false
    api
      .getGraphLayout()
      .then((layout) => {
        if (!cancelled) {
          savedLayoutRef.current = layout ?? {}
          rebuild()
        }
      })
      .catch(() => rebuild())
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.path])

  useEffect(() => {
    if (savedLayoutRef.current) rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars, rels])

  const persistPositions = (source?: Node<CharNodeData>[]): void => {
    const merged = { ...savedLayoutRef.current, ...positionsOf(nodesRef.current) }
    if (source) for (const n of source) merged[n.id] = { x: n.position.x, y: n.position.y }
    savedLayoutRef.current = merged
    void api.saveGraphLayout(merged)
  }

  const startNew = (): void => {
    setEditing({ id: '', fromId: chars[0]?.id ?? '', toId: chars[1]?.id ?? '', type: '', label: '', description: '', directed: false })
    setIsNew(true)
    setView('list')
  }

  const saveEditing = async (): Promise<void> => {
    if (!editing) return
    const next = isNew ? [...rels, { ...editing, id: `rel_${Date.now().toString(36)}` }] : rels.map((r) => (r.id === editing.id ? editing : r))
    await api.saveRelationships(next.filter((r) => r.fromId && r.toId && r.fromId !== r.toId))
    setEditing(null)
    await refresh()
  }

  const removeRel = async (id: string): Promise<void> => {
    await api.saveRelationships(rels.filter((r) => r.id !== id))
    if (editing?.id === id) setEditing(null)
    await refresh()
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="flex rounded-lg border border-line p-0.5">
            {(['graph', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition',
                  view === v ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'
                )}
              >
                {v === 'graph' ? '图谱' : '列表'}
              </button>
            ))}
          </div>
          <span className="text-xs text-faint">
            {chars.length} 位人物 · {rels.length} 条关系
          </span>
          {/* 阵营图例 */}
          {[...new Set(chars.map((c) => (c.faction ?? '').trim()).filter(Boolean))].slice(0, 6).map((f) => (
            <span key={f} className="flex items-center gap-1 text-[11px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: factionColor(f) }} />
              {f}
            </span>
          ))}
          <div className="flex-1" />
          <Button size="sm" variant="primary" onClick={startNew} disabled={chars.length < 2}>
            <Plus size={13} /> 新增关系
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {chars.length === 0 ? (
            <EmptyState icon={<Network size={32} />} title="先在「人物」页创建人物" hint="至少两位人物才能建立关系" />
          ) : view === 'graph' ? (
            rels.length === 0 ? (
              <EmptyState icon={<Network size={32} />} title="还没有关系连线" hint="点击右上角「新增关系」开始编织关系网" />
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.3}
                proOptions={{ hideAttribution: true }}
                onNodeDragStop={(_, __, dragged) => persistPositions(dragged)}
                onEdgeClick={(_, edge) => {
                  const hit = rels.find((r) => r.id === edge.id)
                  if (hit) {
                    setEditing({ ...hit })
                    setIsNew(false)
                    setView('list')
                  }
                }}
              >
                <Background gap={24} color="var(--line)" />
                <Controls showInteractive={false} />
              </ReactFlow>
            )
          ) : (
            <div className="h-full space-y-2 overflow-y-auto p-4">
              {rels.length === 0 && <EmptyState title="暂无关系" />}
              {rels.map((r) => (
                <div key={r.id} className="group flex items-center gap-3 rounded-lg border border-line bg-panel p-3 transition hover:bg-elevated">
                  <div className="text-sm">
                    <span className="font-medium">{nameOf(r.fromId)}</span>
                    <span className="mx-1.5 text-faint">{r.directed ? '→' : '⇄'}</span>
                    <span className="font-medium">{nameOf(r.toId)}</span>
                  </div>
                  <Badge tone="accent">{r.type}</Badge>
                  {r.label && <Badge>{r.label}</Badge>}
                  {r.description && <span className="truncate text-xs text-muted">{r.description}</span>}
                  <div className="ml-auto flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing({ ...r }); setIsNew(false); }}>
                      编辑
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => void removeRel(r.id)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 编辑侧栏 */}
      {editing && (
        <aside className="w-80 shrink-0 space-y-3.5 overflow-y-auto border-l border-line p-4">
          <div className="text-sm font-medium">{isNew ? '新增关系' : '编辑关系'}</div>
          <Field label="起始人物">
            <select value={editing.fromId} onChange={(e) => setEditing({ ...editing, fromId: e.target.value })} className={REL_SELECT_CLS}>
              {chars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="指向人物">
            <select value={editing.toId} onChange={(e) => setEditing({ ...editing, toId: e.target.value })} className={REL_SELECT_CLS}>
              {chars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="关系类别">
            <Input
              value={editing.type}
              onChange={(e) => setEditing({ ...editing, type: e.target.value })}
              placeholder="亲属 / 恋人 / 敌对…"
              list="rel-type-presets"
            />
            <datalist id="rel-type-presets">
              {REL_TYPE_PRESETS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="关系短语（可选）">
            <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="青梅竹马" />
          </Field>
          <Field label="说明（可选）">
            <textarea
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              rows={4}
              className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="关系的来龙去脉……"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.directed}
              onChange={(e) => setEditing({ ...editing, directed: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            有方向性（图中显示箭头）
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void saveEditing()} disabled={!editing.type.trim()}>
              保存
            </Button>
          </div>
        </aside>
      )}
    </div>
  )
}
