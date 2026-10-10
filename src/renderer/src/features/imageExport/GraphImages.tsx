import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { ReactNode } from 'react'
import type { VolumeMeta } from '../../../../shared/types'
import { factionColor } from '../../lib/utils'
import type { selectEventGraph, selectRelationshipGraph } from './selection'

type Point = { x: number; y: number; width: number; height: number }
const nodeStyle = { position: 'absolute' as const, padding: '18px 20px', boxSizing: 'border-box' as const, borderRadius: 12, background: '#fff', color: '#292524', overflowWrap: 'anywhere' as const, fontSize: 15, lineHeight: 1.7 }

function GraphFrame({ title, subtitle, workspaceName, width, height, children }: { title: string; subtitle: string; workspaceName: string; width: number; height: number; children: ReactNode }) {
  return <article style={{ width: Math.max(760, width), padding: '30px 36px', boxSizing: 'border-box', background: '#fffdf8', color: '#292524', fontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif' }}>
    <div style={{ color: '#78716c', fontSize: 14, overflowWrap: 'anywhere' }}>{workspaceName} · StoryFabric</div>
    <h1 style={{ fontSize: 28, fontWeight: 700, margin: '10px 0' }}>{title}</h1>
    <p style={{ color: '#78716c', fontSize: 14, margin: '0 0 24px' }}>{subtitle}</p>
    <div style={{ position: 'relative', width: width - 72, height }}>{children}</div>
  </article>
}

function Connectors({ points, edges, width, height }: { points: Record<string, Point>; edges: Array<{ id: string; source: string; target: string; directed: boolean; branch?: boolean }>; width: number; height: number }) {
  return <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
    <defs><marker id="sf-export-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a87927" /></marker></defs>
    {edges.map((edge) => {
      const a = points[edge.source]; const b = points[edge.target]
      if (!a || !b) return null
      const forward = b.x >= a.x
      const x1 = a.x + (forward ? a.width : 0); const x2 = b.x + (forward ? 0 : b.width)
      const y1 = a.y + a.height / 2; const y2 = b.y + b.height / 2
      const bend = Math.max(60, Math.abs(x2 - x1) / 2)
      return <path key={edge.id} data-export-edge={edge.id} d={`M${x1},${y1} C${x1 + (forward ? bend : -bend)},${y1} ${x2 + (forward ? -bend : bend)},${y2} ${x2},${y2}`} fill="none" stroke={edge.branch ? '#cd7258' : '#a87927'} strokeWidth={2} strokeDasharray={edge.branch ? '7 5' : undefined} markerEnd={edge.directed ? 'url(#sf-export-arrow)' : undefined} />
    })}
  </svg>
}

export function RelationshipGraphImage({ graph, workspaceName }: { graph: ReturnType<typeof selectRelationshipGraph>; workspaceName: string }): React.ReactElement {
  const size = Math.max(300, Math.sqrt(graph.characters.length) * 180)
  const simulated = graph.characters.map((character, i) => ({ id: character.id, x: Math.cos(i * 2 * Math.PI / graph.characters.length) * size, y: Math.sin(i * 2 * Math.PI / graph.characters.length) * size }))
  const simulation = forceSimulation(simulated).force('charge', forceManyBody().strength(-800)).force('center', forceCenter(0, 0))
    .force('collision', forceCollide(180)).force('links', forceLink(graph.relationships.map((relationship) => ({ source: relationship.fromId, target: relationship.toId }))).id((d) => (d as { id: string }).id).distance(380)).stop()
  simulation.tick(240)
  const minX = Math.min(0, ...simulated.map((point) => point.x!)); const minY = Math.min(0, ...simulated.map((point) => point.y!))
  const points: Record<string, Point> = {}
  simulated.forEach((point, i) => {
    const character = graph.characters[i]
    const lines = Math.ceil(character.name.length / 11) + Math.ceil((character.faction?.length ?? 0) / 12) + Math.ceil((character.role?.length ?? 0) / 12)
    points[point.id] = { x: point.x! - minX + 30, y: point.y! - minY + 30, width: 220, height: Math.max(112, lines * 28 + 50) }
  })
  const width = Math.max(760, ...Object.values(points).map((point) => point.x + point.width + 102))
  const height = Math.max(220, ...Object.values(points).map((point) => point.y + point.height + 40))
  return <GraphFrame title="人物关系图" workspaceName={workspaceName} subtitle={`${graph.characters.length} 位已选人物 · ${graph.relationships.length} 条已选关系 · 箭头表示关系方向`} width={width} height={height}>
    <Connectors points={points} edges={graph.relationships.map((relationship) => ({ id: relationship.id, source: relationship.fromId, target: relationship.toId, directed: relationship.directed }))} width={width - 72} height={height} />
    {graph.relationships.map((relationship) => {
      const a = points[relationship.fromId]; const b = points[relationship.toId]
      return <div key={relationship.id} style={{ position: 'absolute', left: (a.x + a.width / 2 + b.x + b.width / 2) / 2 - 80, top: (a.y + a.height / 2 + b.y + b.height / 2) / 2 - 14, width: 160, background: '#fffdf8', color: '#78716c', fontSize: 13, textAlign: 'center', lineHeight: 1.6, overflowWrap: 'anywhere', padding: 4 }}>{[relationship.type, relationship.label].filter(Boolean).join(' · ')}</div>
    })}
    {graph.characters.map((character) => <div key={character.id} data-export-node={character.id} style={{ ...nodeStyle, left: points[character.id].x, top: points[character.id].y, width: points[character.id].width, minHeight: points[character.id].height, border: `3px solid ${factionColor(character.faction)}` }}>
      <strong style={{ fontSize: 19 }}>{character.name}</strong>
      {character.faction && <div style={{ color: '#78716c', marginTop: 5 }}>{character.faction}</div>}
      {character.role && <div style={{ color: '#78716c', fontSize: 13 }}>{character.role}</div>}
    </div>)}
  </GraphFrame>
}

export function EventGraphImage({ graph, volumes, workspaceName }: { graph: ReturnType<typeof selectEventGraph>; volumes: VolumeMeta[]; workspaceName: string }): React.ReactElement {
  const points: Record<string, Point> = {}
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(graph.events.length))))
  let rowY = 24
  for (let row = 0; row * columns < graph.events.length; row++) {
    const items = graph.events.slice(row * columns, (row + 1) * columns)
    const heights = items.map((event) => 110 + Math.ceil(event.title.length / 12) * 28 + Math.ceil(event.storyTime.length / 15) * 22 + (graph.boundaries.some((boundary) => boundary.eventId === event.id) ? 52 : 0))
    items.forEach((event, i) => { points[event.id] = { x: 24 + (row % 2 ? columns - 1 - i : i) * 310, y: rowY, width: 240, height: heights[i] } })
    rowY += Math.max(...heights) + 90
  }
  const width = Math.max(760, columns * 310 + 96)
  const names = new Map(volumes.map((volume) => [volume.id, volume.title]))
  return <GraphFrame title="事件脉络图" workspaceName={workspaceName} subtitle={`${graph.events.length} 个已选事件 · 实线为主线，虚线为分支 · 范围外事件仅显示连接标记`} width={width} height={rowY}>
    <Connectors points={points} edges={graph.edges.map((edge) => ({ ...edge, directed: true, branch: edge.kind === 'branch' }))} width={width - 72} height={rowY} />
    {graph.events.map((event) => {
      const boundaries = graph.boundaries.filter((boundary) => boundary.eventId === event.id)
      return <div key={event.id} data-export-node={event.id} style={{ ...nodeStyle, left: points[event.id].x, top: points[event.id].y, width: points[event.id].width, minHeight: points[event.id].height, border: `2px solid ${event.branchFromId ? '#cd7258' : '#a87927'}` }}>
        <div style={{ fontSize: 12, color: '#78716c', marginBottom: 8 }}>{names.get(event.volumeId ?? 'vol_default') ?? '未分卷'} · {event.branchFromId ? '分支' : '主线'}</div>
        <strong style={{ fontSize: 18 }}>{event.title}</strong>
        {event.storyTime && <div style={{ color: '#78716c', fontSize: 13, marginTop: 8 }}>{event.storyTime}</div>}
        {boundaries.length > 0 && <div style={{ borderTop: '1px dashed #c7bba7', marginTop: 14, paddingTop: 8, fontSize: 11, color: '#78716c' }}>
          {boundaries.some((boundary) => boundary.direction === 'incoming') && <div>← 连接范围外事件</div>}
          {boundaries.some((boundary) => boundary.direction === 'outgoing') && <div>连接范围外事件 →</div>}
        </div>}
      </div>
    })}
  </GraphFrame>
}
