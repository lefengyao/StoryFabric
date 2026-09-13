import type { StoryEvent, VolumeMeta } from '../../../../shared/types'
import { buildEventGraph } from '../../../../core/workspace/eventGraph'

export const EVENT_X_GAP = 292
export const EVENT_BRANCH_Y_GAP = 176
export const EVENT_CANVAS_PADDING = 120

export interface EventPosition {
  x: number
  y: number
}

export interface EventVolumeSection {
  id: string
  title: string
  order: number
  x: number
  width: number
  eventCount: number
}

export interface EventLayout {
  positions: Record<string, EventPosition>
  mainlineIds: string[]
  branchIds: Set<string>
  edgeKinds: Record<string, 'main' | 'branch'>
  volumes: EventVolumeSection[]
  width: number
  height: number
}

export function layoutEventGraph(
  events: StoryEvent[],
  volumes: VolumeMeta[] = []
): EventLayout {
  const graph = buildEventGraph(events)
  const byId = new Map(events.map((event) => [event.id, event]))
  const positions: Record<string, EventPosition> = {}
  const branchIds = new Set(graph.branches.flatMap((branch) => branch.eventIds))
  const maxBranchDepth = new Map<string, number>()

  graph.mainlineIds.forEach((id, index) => {
    positions[id] = { x: EVENT_CANVAS_PADDING + index * EVENT_X_GAP, y: 0 }
  })

  const branchCountByParent = new Map<string, number>()
  for (const branch of graph.branches) {
    const parentPosition = positions[branch.parentId] ?? { x: EVENT_CANVAS_PADDING, y: 0 }
    const siblingIndex = branchCountByParent.get(branch.parentId) ?? 0
    branchCountByParent.set(branch.parentId, siblingIndex + 1)
    const baseY = EVENT_BRANCH_Y_GAP * (siblingIndex + 1)
    branch.eventIds.forEach((id, index) => {
      const nestedDepth = maxBranchDepth.get(branch.parentId) ?? 0
      positions[id] = {
        x: parentPosition.x + (index + 1) * EVENT_X_GAP,
        y: baseY + nestedDepth * 28
      }
      maxBranchDepth.set(id, nestedDepth + 1)
    })
  }

  // A malformed legacy graph may contain an event not reachable from the mainline.
  const remaining = events
    .filter((event) => !positions[event.id])
    .sort((a, b) => a.order - b.order)
  remaining.forEach((event, index) => {
    positions[event.id] = {
      x: EVENT_CANVAS_PADDING + (graph.mainlineIds.length + index) * EVENT_X_GAP,
      y: EVENT_BRANCH_Y_GAP
    }
  })

  const volumeOrder = new Map(volumes.map((volume) => [volume.id, volume.order]))
  const volumeGroups = new Map<string, { ids: string[]; min: number; max: number; count: number }>()
  for (const event of events) {
    const volumeId = event.volumeId ?? 'vol_default'
    const position = positions[event.id]
    if (!position) continue
    const group = volumeGroups.get(volumeId) ?? { ids: [], min: position.x, max: position.x, count: 0 }
    group.ids.push(event.id)
    group.min = Math.min(group.min, position.x)
    group.max = Math.max(group.max, position.x)
    group.count += 1
    volumeGroups.set(volumeId, group)
  }

  const volumeSections = [...volumeGroups.entries()]
    .map(([id, group]) => {
      const volume = volumes.find((item) => item.id === id)
      const left = Math.max(0, group.min - 74)
      const right = group.max + 210
      return {
        id,
        title: volume?.title ?? '未分卷',
        order: volumeOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
        x: left,
        width: Math.max(238, right - left),
        eventCount: group.count
      }
    })
    .sort((a, b) => a.order - b.order || a.x - b.x)

  const maxX = Math.max(EVENT_CANVAS_PADDING + EVENT_X_GAP, ...Object.values(positions).map((position) => position.x + 250))
  const maxY = Math.max(EVENT_CANVAS_PADDING, ...Object.values(positions).map((position) => position.y + 190))
  const edgeKinds = Object.fromEntries(graph.edges.map((edge) => [edge.id, edge.kind]))

  return {
    positions,
    mainlineIds: graph.mainlineIds,
    branchIds,
    edgeKinds,
    volumes: volumeSections,
    width: maxX + EVENT_CANVAS_PADDING,
    height: maxY + EVENT_CANVAS_PADDING
  }
}

export function eventLabel(eventId: string, events: StoryEvent[]): string {
  return events.find((event) => event.id === eventId)?.title ?? '未命名事件'
}
