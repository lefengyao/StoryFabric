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

export interface EventGraphIssue {
  code: 'DUPLICATE_ID' | 'MISSING_VOLUME' | 'MISSING_CHARACTER' | 'MISSING_EVENT' | 'SELF_LOOP' | 'MULTIPLE_PREDECESSORS' | 'MULTIPLE_SUCCESSORS' | 'ASYMMETRIC_LINK' | 'INVALID_BRANCH_PARENT' | 'BRANCH_PARENT_MISMATCH' | 'CYCLE'
  eventId: string
  message: string
}

export interface EventGraphContext {
  volumeIds?: Set<string>
  characterIds?: Set<string>
}

function uniqueIds(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).filter(Boolean)))
}

function ordered(events: StoryEvent[]): StoryEvent[] {
  return [...events].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'))
}

export function normalizeEventGraphChange(events: StoryEvent[], changed: StoryEvent): StoryEvent[] {
  const normalized: StoryEvent = {
    ...changed,
    prevIds: uniqueIds(changed.prevIds).slice(0, 1),
    nextIds: uniqueIds(changed.nextIds).slice(0, 1),
    branchIds: uniqueIds(changed.branchIds)
  }
  const list = events.some((event) => event.id === changed.id)
    ? events.map((event) => event.id === changed.id ? normalized : {
      ...event,
      prevIds: [...(event.prevIds ?? [])],
      nextIds: [...(event.nextIds ?? [])],
      branchIds: [...(event.branchIds ?? [])],
      tags: [...event.tags],
      characterIds: [...event.characterIds]
    })
    : [...events.map((event) => ({
      ...event,
      prevIds: [...(event.prevIds ?? [])],
      nextIds: [...(event.nextIds ?? [])],
      branchIds: [...(event.branchIds ?? [])],
      tags: [...event.tags],
      characterIds: [...event.characterIds]
    })), normalized]

  for (const event of list) {
    event.prevIds = uniqueIds(event.prevIds).filter((id) => id !== changed.id)
    event.nextIds = uniqueIds(event.nextIds).filter((id) => id !== changed.id)
    event.branchIds = uniqueIds(event.branchIds).filter((id) => id !== changed.id)
  }

  if (!normalized.branchFromId && normalized.prevIds.length === 0 && normalized.nextIds.length === 0) {
    const mainline = buildEventGraph(list.filter((event) => event.id !== normalized.id)).mainlineIds
    const tail = mainline.at(-1)
    if (tail) normalized.prevIds = [tail]
  }

  for (const previousId of normalized.prevIds) {
    const previous = list.find((event) => event.id === previousId)
    if (previous) previous.nextIds = [normalized.id]
  }
  for (const nextId of normalized.nextIds) {
    const next = list.find((event) => event.id === nextId)
    if (next) next.prevIds = [normalized.id]
  }
  if (normalized.branchFromId) {
    const parent = list.find((event) => event.id === normalized.branchFromId)
    if (parent) parent.branchIds = uniqueIds([...(parent.branchIds ?? []), normalized.id])
  }
  return list.map((event) => ({
    ...event,
    prevIds: uniqueIds(event.prevIds).slice(0, 1),
    nextIds: uniqueIds(event.nextIds).slice(0, 1),
    branchIds: uniqueIds(event.branchIds)
  }))
}

export function diagnoseEventGraph(events: StoryEvent[], context: EventGraphContext = {}): EventGraphIssue[] {
  const issues: EventGraphIssue[] = []
  const byId = new Map<string, StoryEvent>()
  for (const event of events) {
    if (byId.has(event.id)) issues.push({ code: 'DUPLICATE_ID', eventId: event.id, message: `事件 id 重复：${event.id}` })
    byId.set(event.id, event)
  }
  const incoming = new Map<string, string[]>()
  for (const event of events) {
    if (context.volumeIds && event.volumeId && !context.volumeIds.has(event.volumeId)) {
      issues.push({ code: 'MISSING_VOLUME', eventId: event.id, message: `事件「${event.title}」引用不存在的卷：${event.volumeId}` })
    }
    for (const characterId of event.characterIds ?? []) {
      if (context.characterIds && !context.characterIds.has(characterId)) {
        issues.push({ code: 'MISSING_CHARACTER', eventId: event.id, message: `事件「${event.title}」引用不存在的人物：${characterId}` })
      }
    }
    for (const nextId of uniqueIds(event.nextIds)) {
      if (nextId === event.id) issues.push({ code: 'SELF_LOOP', eventId: event.id, message: `事件「${event.title}」不能连接到自身` })
      if (!byId.has(nextId)) issues.push({ code: 'MISSING_EVENT', eventId: event.id, message: `事件「${event.title}」引用不存在的后续事件：${nextId}` })
      incoming.set(nextId, [...(incoming.get(nextId) ?? []), event.id])
      const next = byId.get(nextId)
      if (next && !uniqueIds(next.prevIds).includes(event.id)) {
        issues.push({ code: 'ASYMMETRIC_LINK', eventId: event.id, message: `事件「${event.title}」到「${next.title}」的前后引用不对称` })
      }
    }
    for (const previousId of uniqueIds(event.prevIds)) {
      if (previousId === event.id) issues.push({ code: 'SELF_LOOP', eventId: event.id, message: `事件「${event.title}」不能连接到自身` })
      if (!byId.has(previousId)) issues.push({ code: 'MISSING_EVENT', eventId: event.id, message: `事件「${event.title}」引用不存在的前置事件：${previousId}` })
    }
    if (uniqueIds(event.nextIds).length > 1) issues.push({ code: 'MULTIPLE_SUCCESSORS', eventId: event.id, message: `事件「${event.title}」存在多个后续事件` })
    if (uniqueIds(event.prevIds).length > 1) issues.push({ code: 'MULTIPLE_PREDECESSORS', eventId: event.id, message: `事件「${event.title}」存在多个前置事件` })
    if (event.branchFromId) {
      const parent = byId.get(event.branchFromId)
      if (!parent) issues.push({ code: 'INVALID_BRANCH_PARENT', eventId: event.id, message: `事件「${event.title}」的分支父事件不存在：${event.branchFromId}` })
      else if (!uniqueIds(parent.branchIds).includes(event.id)) issues.push({ code: 'BRANCH_PARENT_MISMATCH', eventId: event.id, message: `分支父事件「${parent.title}」未登记该分支：${event.id}` })
    }
  }
  for (const [id, sources] of incoming) {
    if (new Set(sources).size > 1) issues.push({ code: 'MULTIPLE_PREDECESSORS', eventId: id, message: `事件存在多个来源，形成合流：${sources.join('、')}` })
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      issues.push({ code: 'CYCLE', eventId: id, message: `事件图存在有向环：${id}` })
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    const event = byId.get(id)
    for (const nextId of uniqueIds(event?.nextIds)) if (byId.has(nextId)) visit(nextId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const event of events) visit(event.id)
  return issues
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
