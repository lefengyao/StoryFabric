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
import { ArrowLeft, Network, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, EmptyState, Field, Input } from '../../components/ui/primitives'
import { useAndroidOverlayFocus } from '../../components/layout/useAndroidOverlayFocus'
import { api } from '../../lib/api'
import { cn, factionColor } from '../../lib/utils'
import type { CharacterDoc, Relationship } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'
import { RelationshipImageExport } from '../../features/imageExport/GraphImageExport'
import { newRelationshipForCharacter, relationshipsForCharacter } from './relationshipInspector'
import { CharacterRelationsPanel } from './CharacterRelationsPanel'

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
  const edges: Edge[] = rels.filter((r) => charById.has(r.fromId) && charById.has(r.toId)).map((r) => ({
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
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editingBaselineRef = useRef<Relationship | null>(null)
  const backgroundRef = useRef<HTMLDivElement | null>(null)
  const isAndroid = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
  const [isNew, setIsNew] = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CharNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const chars = summary?.characters ?? []
  const rels = useMemo(() => [...(summary?.relationships ?? [])].sort((a, b) => a.id.localeCompare(b.id)), [summary?.relationships])
  const nameOf = (id: string): string => chars.find((c) => c.id === id)?.name ?? '？'
  const selectedCharacter = chars.find((character) => character.id === selectedCharacterId) ?? null
  const inspectorOpen = Boolean(editing || selectedCharacter)
  const inspectorRef = useAndroidOverlayFocus(inspectorOpen, '[data-android-inspector-return="relations"]', backgroundRef)
  const characterRelationships = selectedCharacter ? relationshipsForCharacter(selectedCharacter, chars, rels) : []
  const mutationPendingRef = useRef(false)
  const workspacePathRef = useRef(summary?.path)
  workspacePathRef.current = summary?.path

  useEffect(() => {
    if (isAndroid && inspectorOpen) inspectorRef.current?.focus()
  }, [isAndroid, inspectorOpen, Boolean(editing), selectedCharacterId, inspectorRef])

  useEffect(() => {
    setSelectedCharacterId(null)
    setEditing(null)
    editingBaselineRef.current = null
    setIsNew(false)
    setSaveError(null)
    savedLayoutRef.current = {}
    nodesRef.current = []
  }, [summary?.path])

  useEffect(() => {
    if (!editing || isNew) return
    const validIds = new Set(chars.map((character) => character.id))
    if (!validIds.has(editing.fromId) || !validIds.has(editing.toId)) {
      setEditing(null)
      setIsNew(false)
      editingBaselineRef.current = null
      setSaveError('关系中的人物已不存在，请重新选择关系。')
    }
  }, [chars, editing, isNew])

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
      .catch(() => { if (!cancelled) rebuild() })
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

  const confirmDiscardEditing = (): boolean => {
    if (mutationPendingRef.current) return false
    if (!editing || JSON.stringify(editing) === JSON.stringify(editingBaselineRef.current)) return true
    return window.confirm('当前关系有未保存修改。切换后将放弃这些修改，是否继续？')
  }

  const openEditing = (relationship: Relationship, newRelationship = false): boolean => {
    if (!confirmDiscardEditing()) return false
    editingBaselineRef.current = { ...relationship }
    setEditing({ ...relationship })
    setIsNew(newRelationship)
    setSaveError(null)
    return true
  }

  const startNew = (characterId?: string): void => {
    if (chars.length < 2) return
    const draft = newRelationshipForCharacter(chars, characterId)
    if (!openEditing(draft, true)) return
    setSelectedCharacterId(characterId ?? null)
    if (!characterId) setView('list')
  }

  const saveEditing = async (): Promise<boolean> => {
    if (!editing || mutationPendingRef.current) return false
    if (!isNew && !rels.some((relationship) => relationship.id === editing.id)) {
      setSaveError('这条关系已被删除，请重新选择关系。')
      return false
    }
    if (!editing.type.trim() || !chars.some((character) => character.id === editing.fromId) || !chars.some((character) => character.id === editing.toId) || editing.fromId === editing.toId) {
      setSaveError('请选择两位不同人物，并填写关系类别。')
      return false
    }
    const scope = summary?.path
    mutationPendingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const validIds = new Set(chars.map((character) => character.id))
      const candidate = isNew ? [...rels, { ...editing, id: `rel_${Date.now().toString(36)}` }] : rels.map((r) => (r.id === editing.id ? editing : r))
      const next = candidate.filter((relationship) => validIds.has(relationship.fromId) && validIds.has(relationship.toId) && relationship.fromId !== relationship.toId)
      await api.saveRelationships(next)
      if (workspacePathRef.current !== scope) return false
      useWorkspace.setState((state) => state.summary && state.summary.path === scope ? { summary: { ...state.summary, relationships: next } } : {})
      setEditing(null)
      setIsNew(false)
      editingBaselineRef.current = null
      try { await refresh() } catch (error) {
        if (workspacePathRef.current === scope) setSaveError(`关系已保存，刷新失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return true
    } catch (error) {
      if (workspacePathRef.current === scope) setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      mutationPendingRef.current = false
      setSaving(false)
    }
  }

  const removeRel = async (id: string): Promise<void> => {
    if (mutationPendingRef.current) return
    if (editing?.id === id && !confirmDiscardEditing()) return
    if (!window.confirm('确定删除这条人物关系？')) return
    const scope = summary?.path
    mutationPendingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const validIds = new Set(chars.map((character) => character.id))
      const next = rels.filter((r) => r.id !== id && validIds.has(r.fromId) && validIds.has(r.toId) && r.fromId !== r.toId)
      await api.saveRelationships(next)
      if (workspacePathRef.current !== scope) return
      useWorkspace.setState((state) => state.summary && state.summary.path === scope ? { summary: { ...state.summary, relationships: next } } : {})
      if (editing?.id === id) {
        setEditing(null)
        setIsNew(false)
        editingBaselineRef.current = null
      }
      try { await refresh() } catch (error) {
        if (workspacePathRef.current === scope) setSaveError(`关系已删除，刷新失败：${error instanceof Error ? error.message : String(error)}`)
      }
    } catch (error) {
      if (workspacePathRef.current === scope) setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      mutationPendingRef.current = false
      setSaving(false)
    }
  }

  const cancelEditing = (confirmDiscard = false): void => {
    if (mutationPendingRef.current || (confirmDiscard && !confirmDiscardEditing())) return
    setEditing(null)
    setIsNew(false)
    editingBaselineRef.current = null
    setSaveError(null)
  }

  return (
    <div className="relative flex h-full min-h-0">
      <div ref={backgroundRef} className="flex min-w-0 flex-1 flex-col">
        <div data-android-page-toolbar className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="flex rounded-lg border border-line p-0.5">
            {(['graph', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                disabled={saving}
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
          <RelationshipImageExport characters={chars} relationships={rels} workspaceName={summary?.name ?? ''} beforeExport={async () => {
            if (mutationPendingRef.current) return false
            if (editing && (isNew || JSON.stringify(editing) !== JSON.stringify(rels.find((relationship) => relationship.id === editing.id)))) {
              if (!window.confirm('当前关系有未保存修改。保存后选择导出范围？取消将保留编辑内容。')) return false
              if (!editing.type.trim() || !editing.fromId || !editing.toId || editing.fromId === editing.toId) throw new Error('请先填写有效的关系类别和两位不同人物')
              if (!await saveEditing()) return false
            }
            return true
          }} />
          <Button data-android-inspector-return="relations" size="sm" variant="primary" onClick={() => startNew()} disabled={chars.length < 2 || saving}>
            <Plus size={13} /> 新增关系
          </Button>
        </div>

        {saveError && !inspectorOpen && <p role="alert" className="border-b border-line px-4 py-2 text-xs text-danger">{saveError}</p>}

        <div className="min-h-0 flex-1">
          {chars.length === 0 ? (
            <EmptyState icon={<Network size={32} />} title="先在「人物」页创建人物" hint="至少两位人物才能建立关系" />
          ) : view === 'graph' ? (
              <ReactFlow
                nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedCharacterId }))}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.3}
                proOptions={{ hideAttribution: true }}
                onNodeDragStop={(_, __, dragged) => persistPositions(dragged)}
                onNodeClick={(_, node) => {
                  if (!confirmDiscardEditing()) return
                  setSelectedCharacterId(node.id)
                  setEditing(null)
                  setIsNew(false)
                  editingBaselineRef.current = null
                  setSaveError(null)
                }}
                onEdgeClick={(_, edge) => {
                  const hit = rels.find((r) => r.id === edge.id)
                  if (hit) {
                    if (!confirmDiscardEditing()) return
                    setSelectedCharacterId(null)
                    editingBaselineRef.current = { ...hit }
                    setEditing({ ...hit })
                    setIsNew(false)
                    setSaveError(null)
                    setView('list')
                  }
                }}
              >
                <Background gap={24} color="var(--line)" />
                <Controls showInteractive={false} />
              </ReactFlow>
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
                    <Button size="sm" variant="ghost" disabled={saving} onClick={() => { if (!openEditing(r)) return; setSelectedCharacterId(null); }}>
                      编辑
                    </Button>
                    <Button size="sm" variant="ghost" disabled={saving} aria-label={`删除${nameOf(r.fromId)}与${nameOf(r.toId)}的关系`} className="text-danger hover:text-danger" onClick={() => void removeRel(r.id)}>
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
      {inspectorOpen && (
        <aside ref={inspectorRef} tabIndex={isAndroid ? -1 : undefined} role={isAndroid ? 'dialog' : undefined} aria-label={editing ? '编辑关系' : `${selectedCharacter?.name ?? '人物'}的关系`} data-android-inspector className="w-80 shrink-0 overflow-y-auto border-l border-line bg-panel p-4 max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:z-20 max-sm:max-w-full max-sm:shadow-lg">
          {editing ? <>
          <div className="mb-4 flex items-center gap-2">
            {selectedCharacter && <Button size="icon" variant="ghost" disabled={saving} aria-label="返回人物关系" onClick={() => cancelEditing(true)}><ArrowLeft size={15} /></Button>}
            <div className="min-w-0 flex-1 text-sm font-medium">{isNew ? '新增关系' : '编辑关系'}</div>
            {!selectedCharacter && <Button size="icon" variant="ghost" disabled={saving} aria-label="关闭关系编辑" onClick={() => cancelEditing(true)}><X size={15} /></Button>}
          </div>
          <fieldset disabled={saving} className="space-y-3.5">
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
            <Button variant="ghost" onClick={() => cancelEditing()}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void saveEditing()} loading={saving} disabled={!editing.type.trim() || !editing.fromId || !editing.toId || editing.fromId === editing.toId}>
              保存
            </Button>
          </div>
          </fieldset>
          {saveError && <p role="alert" className="mt-3 text-xs text-danger">{saveError}</p>}
          </> : selectedCharacter ? <CharacterRelationsPanel
            character={selectedCharacter}
            items={characterRelationships}
            canAdd={chars.length >= 2}
            busy={saving}
            error={saveError}
            onAdd={() => startNew(selectedCharacter.id)}
            onEdit={(relationship) => { openEditing(relationship) }}
            onDelete={(id) => { void removeRel(id) }}
            onClose={() => { if (!mutationPendingRef.current) { setSelectedCharacterId(null); setSaveError(null) } }}
          /> : null}
        </aside>
      )}
    </div>
  )
}
