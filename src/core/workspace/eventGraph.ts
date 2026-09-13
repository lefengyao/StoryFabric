import type { StoryEvent } from '../../shared/types'

export type EventEdgeKind = 'main' | 'branch'

export interface EventEdge {
  id: string
  source: string
  target: string
  kind: EventEdgeKind
}

export interface EventBranchChain {
  parentId: string
  rootId: string
  eventIds: string[]
}

export interface EventGraphModel {
  mainlineIds: string[]
  branches: EventBranchChain[]
  edges: EventEdge[]
}

function uniqueIds(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).filter(Boolean)))
}

function ordered(events: StoryEvent[]): StoryEvent[] {
  return [...events].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'))
}

export function buildEventGraph(events: StoryEvent[]): EventGraphModel {
  const sorted = ordered(events)
  const byId = new Map(sorted.map((event) => [event.id, event]))
  const mainlineCandidates = sorted.filter((event) => !event.branchFromId && byId.has(event.id))
  const referencedMainline = new Set(
    mainlineCandidates.flatMap((event) => uniqueIds(event.nextIds)).filter((id) => byId.get(id) && !byId.get(id)?.branchFromId)
  )
  const roots = mainlineCandidates.filter((event) => !referencedMainline.has(event.id))
  const start = roots[0] ?? mainlineCandidates[0]
  const mainlineIds: string[] = []
  const visited = new Set<string>()

  const appendMainline = (startId: string | undefined): void => {
    let current = startId
    while (current && !visited.has(current)) {
      const event = byId.get(current)
      if (!event || event.branchFromId) break
      visited.add(current)
      mainlineIds.push(current)
      current = uniqueIds(event.nextIds).find((id) => {
        const candidate = byId.get(id)
        return candidate && !candidate.branchFromId && !visited.has(id)
      })
    }
  }

  appendMainline(start?.id)
  for (const event of mainlineCandidates) appendMainline(event.id)

  const branches: EventBranchChain[] = []
  const branchEdges: EventEdge[] = []
  const branchRoots = new Map<string, string[]>()
  for (const event of sorted) {
    const rootsFromChildren = sorted
      .filter((candidate) => candidate.branchFromId === event.id)
      .map((candidate) => candidate.id)
    const rootIds = uniqueIds([...(event.branchIds ?? []), ...rootsFromChildren]).filter((id) => {
      const child = byId.get(id)
      return child && child.branchFromId === event.id
    })
    if (rootIds.length) branchRoots.set(event.id, rootIds)
  }

  const branchVisited = new Set<string>()
  for (const parent of sorted) {
    for (const rootId of branchRoots.get(parent.id) ?? []) {
      if (branchVisited.has(rootId)) continue
      const chain: string[] = []
      let current: string | undefined = rootId
      while (current && !branchVisited.has(current)) {
        const event = byId.get(current)
        if (!event || event.branchFromId !== parent.id) break
        branchVisited.add(current)
        chain.push(current)
        current = uniqueIds(event.nextIds).find((id) => byId.get(id)?.branchFromId === parent.id && !branchVisited.has(id))
      }
      if (chain.length) {
        branches.push({ parentId: parent.id, rootId, eventIds: chain })
        branchEdges.push({ id: `branch:${parent.id}:${rootId}`, source: parent.id, target: rootId, kind: 'branch' })
        for (let index = 1; index < chain.length; index += 1) {
          branchEdges.push({ id: `branch:${chain[index - 1]}:${chain[index]}`, source: chain[index - 1], target: chain[index], kind: 'branch' })
        }
      }
    }
  }

  const mainEdges: EventEdge[] = []
  for (let index = 1; index < mainlineIds.length; index += 1) {
    mainEdges.push({ id: `main:${mainlineIds[index - 1]}:${mainlineIds[index]}`, source: mainlineIds[index - 1], target: mainlineIds[index], kind: 'main' })
  }

  return { mainlineIds, branches, edges: [...mainEdges, ...branchEdges] }
}

export function eventNextId(event: StoryEvent, events: StoryEvent[]): string | undefined {
  const byId = new Map(events.map((item) => [item.id, item]))
  if (event.branchFromId) {
    return uniqueIds(event.nextIds).find((id) => byId.get(id)?.branchFromId === event.branchFromId)
  }
  return uniqueIds(event.nextIds).find((id) => !byId.get(id)?.branchFromId)
}

/**
 * Removes an event and heals its line without allowing branches to merge.
 * A branch child inherits the deleted branch root's parent so the branch
 * remains separate from the mainline.
 */
export function removeEventFromGraph(events: StoryEvent[], id: string): StoryEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]))
  const target = byId.get(id)
  if (!target) return events

  const previousId = uniqueIds(target.prevIds).find((candidate) => byId.has(candidate))
    ?? events.find((event) => uniqueIds(event.nextIds).includes(id))?.id
  const nextId = eventNextId(target, events)
  const parent = target.branchFromId ? byId.get(target.branchFromId) : undefined

  return events
    .filter((event) => event.id !== id)
    .map((event) => {
      const nextIds = uniqueIds(event.nextIds).filter((candidate) => candidate !== id)
      const prevIds = uniqueIds(event.prevIds).filter((candidate) => candidate !== id)
      const branchIds = uniqueIds(event.branchIds).filter((candidate) => candidate !== id)
      const inheritedBranchFromId = event.id === nextId
        ? target.branchFromId
        : event.branchFromId

      if (event.id === previousId && nextId) nextIds.push(nextId)
      if (event.id === nextId) {
        prevIds.length = 0
        if (previousId) prevIds.push(previousId)
      }
      if (event.id === parent?.id && !nextId) branchIds.length = 0
      if (event.id === parent?.id && nextId) branchIds.push(nextId)

      return {
        ...event,
        prevIds: uniqueIds(prevIds),
        nextIds: uniqueIds(nextIds),
        branchIds: uniqueIds(branchIds),
        ...(inheritedBranchFromId ? { branchFromId: inheritedBranchFromId } : {})
      }
    })
}
