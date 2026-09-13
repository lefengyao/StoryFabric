import '@xyflow/react/dist/style.css'
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance
} from '@xyflow/react'
import {
  ArrowRight,
  CornerDownRight,
  GitBranch,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Waypoints,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Badge, Button, EmptyState, Field, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { splitDelimitedText } from '../../lib/delimitedInput'
import { buildEventGraph, eventNextId } from '../../../../core/workspace/eventGraph'
import type { StoryEvent } from '../../../../shared/types'
import { useWorkspace } from '../../stores/workspaceStore'
import { layoutEventGraph } from './eventLayout'

interface EventNodeData extends Record<string, unknown> {
  title: string
  storyTime: string
  location: string
  volumeTitle: string
  branch: boolean
  characterCount: number
}

interface VolumeBandData extends Record<string, unknown> {
  title: string
  eventCount: number
  width: number
  height: number
}

type EventFlowNode = Node<EventNodeData | VolumeBandData>

function EventNode({ data, selected }: NodeProps<Node<EventNodeData>>): React.ReactElement {
  return (
    <div
      className={`event-timeline-node w-[222px] rounded-xl border-2 bg-panel px-3.5 py-3 text-left shadow-sm transition ${
        selected ? 'border-accent shadow-accent/15' : 'border-line hover:border-accent/45'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent" />
      <div className="flex min-w-0 items-start gap-2">
        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${data.branch ? 'bg-coral/10 text-coral' : 'bg-accent-soft text-accent'}`}>
          {data.branch ? <CornerDownRight size={13} /> : <Waypoints size={13} />}
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{data.title}</strong>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={data.branch ? 'default' : 'accent'}>{data.branch ? '分支' : '主线'}</Badge>
            <Badge>{data.volumeTitle}</Badge>
          </div>
        </div>
      </div>
      {(data.storyTime || data.location || data.characterCount > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
          {data.storyTime && <span>{data.storyTime}</span>}
          {data.location && <span className="inline-flex items-center gap-0.5"><MapPin size={9} />{data.location}</span>}
          {data.characterCount > 0 && <span>{data.characterCount} 位人物</span>}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent" />
    </div>
  )
}

function VolumeBandNode({ data }: NodeProps<Node<VolumeBandData>>): React.ReactElement {
  return (
    <div
      className="pointer-events-none rounded-2xl border border-dashed border-line/80 bg-elevated/25"
      style={{ width: data.width, height: data.height }}
    >
      <div className="absolute left-4 top-3 text-[11px] font-semibold tracking-wide text-faint">
        {data.title} · {data.eventCount} 个事件
      </div>
    </div>
  )
}

const nodeTypes = { eventNode: EventNode, volumeBand: VolumeBandNode }

type LinkIntent =
  | { kind: 'extend-main'; parent: StoryEvent; next?: StoryEvent }
  | { kind: 'insert-main'; parent: StoryEvent; next: StoryEvent }
  | { kind: 'extend-branch'; parent: StoryEvent; next?: StoryEvent }
  | { kind: 'add-branch'; parent: StoryEvent }

interface ActionMenu {
  eventId: string
  x: number
  y: number
}

function createEventDraft(volumeId: string, order: number, overrides: Partial<StoryEvent> = {}): StoryEvent {
  return {
    id: '',
    title: '',
    volumeId,
    storyTime: '',
    order,
    location: '',
    tags: [],
    characterIds: [],
    prevIds: [],
    nextIds: [],
    branchIds: [],
    content: '',
    ...overrides
  }
}

export function EventsPage(): React.ReactElement {
  const summary = useWorkspace((s) => s.summary)
  const refresh = useWorkspace((s) => s.refresh)
  const events = useMemo(() => [...(summary?.events ?? [])].sort((a, b) => a.order - b.order), [summary?.events])
  const volumes = summary?.volumes ?? []
  const chars = summary?.characters ?? []
  const layout = useMemo(() => layoutEventGraph(events, volumes), [events, volumes])
  const graph = useMemo(() => buildEventGraph(events), [events])

  const [nodes, setNodes, onNodesChange] = useNodesState<EventFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [flow, setFlow] = useState<ReactFlowInstance<EventFlowNode, Edge> | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [actionMenu, setActionMenu] = useState<ActionMenu | null>(null)
  const [editing, setEditing] = useState<StoryEvent | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [tagsText, setTagsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [linkIntent, setLinkIntent] = useState<LinkIntent | null>(null)

  useEffect(() => {
    const volumeTitle = new Map(volumes.map((volume) => [volume.id, volume.title]))
    const nextNodes: EventFlowNode[] = layout.volumes.map((section) => ({
      id: `volume:${section.id}`,
      type: 'volumeBand',
      position: { x: section.x, y: -28 },
      data: {
        title: section.title,
        eventCount: section.eventCount,
        width: section.width,
        height: layout.height - 20
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: -1
    }))
    for (const event of events) {
      const position = layout.positions[event.id]
      if (!position) continue
      nextNodes.push({
        id: event.id,
        type: 'eventNode',
        position,
        data: {
          title: event.title,
          storyTime: event.storyTime,
          location: event.location,
          volumeTitle: volumeTitle.get(event.volumeId ?? 'vol_default') ?? '未分卷',
          branch: Boolean(event.branchFromId),
          characterCount: event.characterIds.length
        },
        zIndex: 1
      })
    }
    setNodes(nextNodes)
    setEdges(graph.edges.map((edge) => {
      const branch = edge.kind === 'branch'
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: branch ? 'var(--coral)' : 'var(--accent)',
          strokeWidth: branch ? 1.8 : 2.2,
          strokeDasharray: branch ? '5 5' : undefined
        },
        label: branch ? '分支' : undefined,
        labelStyle: { fontSize: 9, fill: 'var(--coral)' },
        labelBgStyle: { fill: 'var(--panel)' }
      } satisfies Edge
    }))
  }, [events, graph.edges, layout.height, layout.positions, layout.volumes, setEdges, setNodes, volumes])

  const selectedEvent = events.find((event) => event.id === actionMenu?.eventId) ?? null

  const startNew = (): void => {
    const mainline = graph.mainlineIds.map((id) => events.find((event) => event.id === id)).filter(Boolean) as StoryEvent[]
    const parent = mainline.at(-1)
    const draft = createEventDraft(parent?.volumeId ?? volumes[0]?.id ?? 'vol_default', (events.length ? Math.max(...events.map((event) => event.order)) : 0) + 1)
    setEditing(draft)
    setLinkIntent(parent ? { kind: 'extend-main', parent } : null)
    setTagsText('')
    setIsNew(true)
    setActionMenu(null)
  }

  const beginLink = (kind: LinkIntent['kind']): void => {
    if (!selectedEvent) return
    const nextId = eventNextId(selectedEvent, events)
    const next = nextId ? events.find((event) => event.id === nextId) : undefined
    const parent = selectedEvent
    let intent: LinkIntent
    if (kind === 'add-branch') intent = { kind, parent }
    else if (kind === 'insert-main') {
      if (!next) return
      intent = { kind, parent, next }
    } else if (kind === 'extend-main') intent = { kind, parent, next }
    else intent = { kind, parent, next }

    const draft = createEventDraft(parent.volumeId ?? volumes[0]?.id ?? 'vol_default', parent.order + 0.25, {
      prevIds: [parent.id],
      nextIds: next && kind !== 'add-branch' ? [next.id] : [],
      ...(kind === 'add-branch' || kind === 'extend-branch'
        ? { branchFromId: kind === 'add-branch' ? parent.id : (parent.branchFromId ?? parent.id) }
        : {})
    })
    setEditing(draft)
    setLinkIntent(intent)
    setTagsText('')
    setIsNew(true)
    setActionMenu(null)
  }

  const save = async (): Promise<void> => {
    if (!editing || !editing.title.trim()) return
    setSaving(true)
    try {
      const id = editing.id || `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const nextEvent: StoryEvent = {
        ...editing,
        id,
        title: editing.title.trim(),
        tags: splitDelimitedText(tagsText),
        volumeId: editing.volumeId ?? volumes[0]?.id ?? 'vol_default',
        branchIds: editing.branchIds ?? []
      }
      await api.saveEvent(nextEvent)

      if (isNew && linkIntent) {
        const parent = linkIntent.parent
        if (linkIntent.kind === 'add-branch') {
          await api.saveEvent({ ...parent, branchIds: Array.from(new Set([...(parent.branchIds ?? []), id])) })
        } else if (linkIntent.next) {
          await api.saveEvent({ ...parent, nextIds: [id] })
          await api.saveEvent({ ...linkIntent.next, prevIds: [id] })
        } else {
          await api.saveEvent({ ...parent, nextIds: [id] })
        }
      }
      setEditing(null)
      setLinkIntent(null)
      setTagsText('')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!editing?.id) return
    await api.deleteEvent(editing.id)
    setConfirmDelete(false)
    setEditing(null)
    setLinkIntent(null)
    await refresh()
  }

  const focusVolume = (volumeId: string): void => {
    const section = layout.volumes.find((volume) => volume.id === volumeId)
    if (!section || !scrollRef.current) return
    scrollRef.current.scrollTo({ left: Math.max(0, section.x - 40), behavior: 'smooth' })
  }

  const toggleChar = (id: string): void => {
    if (!editing) return
    const has = editing.characterIds.includes(id)
    setEditing({ ...editing, characterIds: has ? editing.characterIds.filter((item) => item !== id) : [...editing.characterIds, id] })
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="text-xs text-faint">全局主线 · 共 {events.length} 个事件</span>
          <div className="mx-1 h-5 w-px bg-line" />
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {layout.volumes.map((volume) => (
              <button
                key={volume.id}
                type="button"
                onClick={() => focusVolume(volume.id)}
                className="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-[11px] text-muted transition hover:border-accent/40 hover:text-fg"
              >
                {volume.title} <span className="text-faint">{volume.eventCount}</span>
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void flow?.zoomOut()} title="缩小"><ZoomOut size={13} /></Button>
          <Button size="sm" variant="ghost" onClick={() => void flow?.zoomIn()} title="放大"><ZoomIn size={13} /></Button>
          <Button size="sm" variant="primary" onClick={startNew}><Plus size={13} /> 新增事件</Button>
        </div>

        {events.length === 0 ? (
          <EmptyState icon={<Waypoints size={32} />} title="事件脉络还是空的" hint="创建第一个事件后，主线和分支会从左向右展开" />
        ) : (
          <div ref={scrollRef} className="event-timeline-scroll min-h-0 flex-1 overflow-auto">
            <div style={{ width: layout.width, height: layout.height, minWidth: '100%', minHeight: '100%' }}>
              <ReactFlow<EventFlowNode, Edge>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onInit={setFlow}
                onNodeClick={(event, node) => {
                  if (node.type !== 'eventNode') return
                  setActionMenu({ eventId: node.id, x: event.clientX, y: event.clientY })
                }}
                onPaneClick={() => setActionMenu(null)}
                fitView
                minZoom={0.35}
                maxZoom={1.6}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={28} color="var(--line)" />
              </ReactFlow>
            </div>
          </div>
        )}
      </div>

      {selectedEvent && actionMenu && (
        <div
          className="fixed z-50 w-52 rounded-xl border border-line bg-panel p-1.5 shadow-2xl"
          style={{ left: Math.min(actionMenu.x, window.innerWidth - 220), top: Math.min(actionMenu.y, window.innerHeight - 260) }}
        >
          <div className="truncate px-2 py-1.5 text-[11px] font-medium text-muted">{selectedEvent.title}</div>
          <button type="button" onClick={() => beginLink(selectedEvent.branchFromId ? 'extend-branch' : (eventNextId(selectedEvent, events) ? 'insert-main' : 'extend-main'))} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-elevated">
            {selectedEvent.branchFromId ? <CornerDownRight size={13} /> : <ArrowRight size={13} />}
            {selectedEvent.branchFromId ? (eventNextId(selectedEvent, events) ? '插入分支事件' : '延长当前分支') : (eventNextId(selectedEvent, events) ? '插入主线事件' : '延长主线')}
          </button>
          <button type="button" onClick={() => beginLink('add-branch')} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-elevated">
            <GitBranch size={13} /> 增加分支
          </button>
          <button type="button" onClick={() => { setEditing({ ...selectedEvent }); setTagsText(selectedEvent.tags.join('，')); setIsNew(false); setLinkIntent(null); setActionMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-elevated">
            <Pencil size={13} /> 编辑事件
          </button>
          <button type="button" onClick={() => { setEditing({ ...selectedEvent }); setConfirmDelete(true); setActionMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-danger hover:bg-danger-soft">
            <Trash2 size={13} /> 删除事件
          </button>
        </div>
      )}

      {editing && (
        <aside className="w-[390px] shrink-0 space-y-3.5 overflow-y-auto border-l border-line p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{isNew ? '新增事件' : '编辑事件'}</span>
            {!isNew && <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> 删除</Button>}
          </div>
          <Field label="标题 *"><Input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="夺旗之夜" autoFocus /></Field>
          <Field label="所属卷">
            <select value={editing.volumeId ?? volumes[0]?.id ?? 'vol_default'} onChange={(event) => setEditing({ ...editing, volumeId: event.target.value })} className="set-select">
              {volumes.length === 0 && <option value="vol_default">第一卷</option>}
              {volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="故事内时间"><Input value={editing.storyTime} onChange={(event) => setEditing({ ...editing, storyTime: event.target.value })} placeholder="第三年·春" /></Field>
            <Field label="地点"><Input value={editing.location} onChange={(event) => setEditing({ ...editing, location: event.target.value })} /></Field>
          </div>
          <Field label="标签（逗号分隔）"><Input value={tagsText} onChange={(event) => setTagsText(event.target.value)} /></Field>
          <Field label={`关联人物（${editing.characterIds.length}）`}>
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line p-2">
              {chars.length === 0 && <span className="text-xs text-faint">尚无人物</span>}
              {chars.map((character) => (
                <button key={character.id} type="button" onClick={() => toggleChar(character.id)} className={`rounded-md px-2 py-1 text-xs transition ${editing.characterIds.includes(character.id) ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted hover:text-fg'}`}>
                  {character.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="事件经过（Markdown）"><div className="h-52"><MarkdownEditor value={editing.content} onChange={(content) => setEditing({ ...editing, content })} /></div></Field>
          <div className="flex justify-end gap-2 pb-2 pt-1">
            <Button variant="ghost" onClick={() => { setEditing(null); setLinkIntent(null); setTagsText('') }}>取消</Button>
            <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!editing.title.trim()}>保存</Button>
          </div>
        </aside>
      )}

      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除「${editing?.title ?? ''}」？`}>
        <p className="text-sm text-muted">删除后事件会移入回收站，主线或分支中的连接会自动重新接合。</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
          <Button variant="danger" onClick={() => void remove()}>确认删除</Button>
        </div>
      </Modal>
    </div>
  )
}
