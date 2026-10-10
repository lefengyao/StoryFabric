import { describe, expect, it } from 'vitest'
import * as implementation from '../selection'
import type { CharacterDoc, Relationship, StoryEvent } from '../../../../../shared/types'

const selection = implementation as unknown as Record<string, (...args: any[]) => any>
const character = (id: string): CharacterDoc => ({ id, name: id, aliases: [], role: '', faction: '', gender: '', age: '', tags: [], summary: '', content: '' })
const event = (id: string, order: number, prevIds: string[] = [], nextIds: string[] = [], extra: Partial<StoryEvent> = {}): StoryEvent => ({ id, title: id, order, prevIds, nextIds, branchIds: [], volumeId: 'v1', storyTime: '', location: '', tags: [], characterIds: [], content: '', ...extra })

describe('image export graph selection', () => {
  it('keeps only explicitly selected relationships with both endpoints, including isolated people', () => {
    expect(selection.selectRelationshipGraph).toBeTypeOf('function')
    const chars = ['a', 'b', 'c', 'isolated'].map(character)
    const rels: Relationship[] = [
      { id: 'ab', fromId: 'a', toId: 'b', directed: true, type: '师徒', label: '旧日', description: '' },
      { id: 'ac', fromId: 'a', toId: 'c', directed: false, type: '朋友', label: '', description: '' },
      { id: 'ba', fromId: 'b', toId: 'a', directed: true, type: '敌对', label: '', description: '' }
    ]
    const result = selection.selectRelationshipGraph(chars, rels, new Set(['a', 'b', 'isolated']), new Set(['ab', 'ac']))
    expect(result.characters.map((c: CharacterDoc) => c.id)).toEqual(['a', 'b', 'isolated'])
    expect(result.relationships.map((r: Relationship) => r.id)).toEqual(['ab'])
    expect(rels).toHaveLength(3)
  })

  it('never bridges over an omitted event and marks both visible boundary endpoints', () => {
    expect(selection.selectEventGraph).toBeTypeOf('function')
    const original = [event('a', 1, [], ['b']), event('b', 2, ['a'], ['c']), event('c', 3, ['b']), event('d', 4)]
    const before = JSON.stringify(original)
    const result = selection.selectEventGraph(original, new Set(['v1']), new Set(['a', 'c', 'd']))
    expect(result.events.map((e: StoryEvent) => e.id)).toEqual(['a', 'c', 'd'])
    expect(result.edges).toEqual([])
    expect(result.boundaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'a', direction: 'outgoing' }),
      expect.objectContaining({ eventId: 'c', direction: 'incoming' })
    ]))
    expect(result.boundaries.some((b: { eventId: string }) => b.eventId === 'd')).toBe(false)
    expect(JSON.stringify(original)).toBe(before)
  })

  it('intersects volume and individual selections and preserves original branch edges only', () => {
    expect(selection.selectEventGraph).toBeTypeOf('function')
    const original = [event('a', 1, [], ['b'], { branchIds: ['branch'] }), event('b', 2, ['a'], [], { volumeId: 'v2' }), event('branch', 3, ['a'], [], { branchFromId: 'a' })]
    const result = selection.selectEventGraph(original, new Set(['v1']), new Set(['a', 'b', 'branch']))
    expect(result.events.map((e: StoryEvent) => e.id)).toEqual(['a', 'branch'])
    expect(result.edges).toEqual([expect.objectContaining({ source: 'a', target: 'branch', kind: 'branch' })])
    expect(result.boundaries).toEqual([expect.objectContaining({ eventId: 'a', direction: 'outgoing', outsideId: 'b' })])
  })
})
