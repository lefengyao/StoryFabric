import type { CharacterDoc, Relationship, StoryEvent } from '../../../../shared/types'

export function selectRelationshipGraph(characters: CharacterDoc[], relationships: Relationship[], characterIds: ReadonlySet<string>, relationshipIds: ReadonlySet<string>) {
  const selected = characters.filter((character) => characterIds.has(character.id))
  const endpoints = new Set(selected.map((character) => character.id))
  return {
    characters: selected,
    relationships: relationships.filter((relationship) => relationshipIds.has(relationship.id) && endpoints.has(relationship.fromId) && endpoints.has(relationship.toId))
  }
}

export interface ExportEventEdge { id: string; source: string; target: string; kind: 'main' | 'branch' }
export interface ExportEventBoundary { eventId: string; outsideId: string; direction: 'incoming' | 'outgoing'; kind: 'main' | 'branch' }

/** Enumerate references before selecting nodes: ordering disconnected nodes never creates an edge. */
export function selectEventGraph(events: StoryEvent[], volumeIds: ReadonlySet<string>, eventIds: ReadonlySet<string>) {
  const selected = events.filter((event) => volumeIds.has(event.volumeId ?? 'vol_default') && eventIds.has(event.id)).sort((a, b) => a.order - b.order)
  const ids = new Set(selected.map((event) => event.id))
  const byId = new Map(events.map((event) => [event.id, event]))
  const references = new Map<string, ExportEventEdge>()
  const add = (source: string, target: string, branch = false): void => {
    if (!source || !target || source === target) return
    const kind = branch || byId.get(target)?.branchFromId ? 'branch' : 'main'
    const key = `${source}:${target}`
    references.set(key, { id: `${kind}:${key}`, source, target, kind })
  }
  for (const event of events) {
    for (const next of event.nextIds ?? []) add(event.id, next)
    for (const prev of event.prevIds ?? []) add(prev, event.id)
    for (const branch of event.branchIds ?? []) add(event.id, branch, true)
  }
  const edges: ExportEventEdge[] = []
  const boundaries: ExportEventBoundary[] = []
  for (const edge of references.values()) {
    if (ids.has(edge.source) && ids.has(edge.target)) edges.push(edge)
    else if (ids.has(edge.source)) boundaries.push({ eventId: edge.source, outsideId: edge.target, direction: 'outgoing', kind: edge.kind })
    else if (ids.has(edge.target)) boundaries.push({ eventId: edge.target, outsideId: edge.source, direction: 'incoming', kind: edge.kind })
  }
  return { events: selected, edges, boundaries }
}
