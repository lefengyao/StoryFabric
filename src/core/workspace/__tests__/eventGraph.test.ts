import { describe, expect, it } from 'vitest'
import type { StoryEvent } from '../../../shared/types'
import { buildEventGraph, diagnoseEventGraph, normalizeEventGraphChange, removeEventFromGraph } from '../eventGraph'

function event(id: string, order: number, overrides: Partial<StoryEvent> = {}): StoryEvent {
  return {
    id,
    title: id,
    volumeId: 'vol_a',
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

describe('event graph', () => {
  it('builds one mainline across volumes and keeps branches outside it', () => {
    const events = [
      event('main_1', 1, { volumeId: 'vol_a', nextIds: ['main_2'] }),
      event('main_2', 2, { volumeId: 'vol_b', prevIds: ['main_1'], nextIds: ['main_3'] }),
      event('main_3', 3, { volumeId: 'vol_b', prevIds: ['main_2'] }),
      event('branch_1', 2.1, { volumeId: 'vol_b', branchFromId: 'main_2', prevIds: ['main_2'], nextIds: ['branch_2'] }),
      event('branch_2', 2.2, { volumeId: 'vol_b', branchFromId: 'main_2', prevIds: ['branch_1'] })
    ]

    const graph = buildEventGraph(events)

    expect(graph.mainlineIds).toEqual(['main_1', 'main_2', 'main_3'])
    expect(graph.branches).toEqual([{ parentId: 'main_2', rootId: 'branch_1', eventIds: ['branch_1', 'branch_2'] }])
    expect(graph.edges.map((edge) => [edge.kind, edge.source, edge.target])).toEqual([
      ['main', 'main_1', 'main_2'],
      ['main', 'main_2', 'main_3'],
      ['branch', 'main_2', 'branch_1'],
      ['branch', 'branch_1', 'branch_2']
    ])
  })

  it('heals the mainline after deleting an event', () => {
    const events = [
      event('a', 1, { nextIds: ['b'] }),
      event('b', 2, { prevIds: ['a'], nextIds: ['c'] }),
      event('c', 3, { prevIds: ['b'] })
    ]

    const next = removeEventFromGraph(events, 'b')

    expect(next.map((item) => item.id)).toEqual(['a', 'c'])
    expect(next.find((item) => item.id === 'a')?.nextIds).toEqual(['c'])
    expect(next.find((item) => item.id === 'c')?.prevIds).toEqual(['a'])
  })

  it('promotes the next branch event without merging it into the mainline', () => {
    const events = [
      event('main', 1, { branchIds: ['branch_1'] }),
      event('branch_1', 2, { branchFromId: 'main', prevIds: ['main'], nextIds: ['branch_2'], branchIds: [] }),
      event('branch_2', 3, { branchFromId: 'main', prevIds: ['branch_1'] })
    ]

    const next = removeEventFromGraph(events, 'branch_1')
    const promoted = next.find((item) => item.id === 'branch_2')
    const parent = next.find((item) => item.id === 'main')

    expect(promoted?.branchFromId).toBe('main')
    expect(promoted?.prevIds).toEqual(['main'])
    expect(parent?.branchIds).toEqual(['branch_2'])
  })

  it('diagnoses cycles, merges, missing references and asymmetric links', () => {
    const issues = diagnoseEventGraph([
      event('a', 1, { nextIds: ['b'] }),
      event('b', 2, { prevIds: ['a'], nextIds: ['a'] }),
      event('c', 3, { prevIds: ['missing'], characterIds: ['char_missing'], volumeId: 'vol_missing' })
    ], { volumeIds: new Set(['vol_a']), characterIds: new Set(['char_a']) })
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['CYCLE', 'ASYMMETRIC_LINK', 'MISSING_EVENT', 'MISSING_CHARACTER', 'MISSING_VOLUME']))
  })

  it('normalizes symmetric links and appends a new mainline event at the tail', () => {
    const events = [event('a', 1), event('b', 2)]
    const normalized = normalizeEventGraphChange(events.map((item, index) => index === 0 ? { ...item, nextIds: ['b'] } : { ...item, prevIds: ['a'] }), event('c', 3))
    expect(normalized.find((item) => item.id === 'b')?.nextIds).toEqual(['c'])
    expect(normalized.find((item) => item.id === 'c')?.prevIds).toEqual(['b'])
  })
})
