import { describe, expect, it } from 'vitest'
import type { CharacterDoc, Relationship } from '../../../../../shared/types'
import { newRelationshipForCharacter, relationshipsForCharacter } from '../relationshipInspector'

const character = (id: string, name: string): CharacterDoc => ({ id, name, aliases: [], role: '', faction: '', gender: '', age: '', tags: [], summary: '', content: '' })
const relationship = (id: string, fromId: string, toId: string, directed: boolean): Relationship => ({ id, fromId, toId, directed, type: '朋友', label: '', description: '', })

describe('character relationship inspector', () => {
  const people = [character('a', '阿青'), character('b', '白露'), character('c', '长风')]

  it('shows every incident relationship with its direction relative to the selected person', () => {
    const result = relationshipsForCharacter(people[0], people, [
      relationship('out', 'a', 'b', true),
      relationship('in', 'c', 'a', true),
      relationship('mutual', 'a', 'c', false),
      relationship('unrelated', 'b', 'c', true),
      relationship('missing', 'a', 'deleted', true)
    ])
    expect(result.map(({ relationship: item, otherCharacter, direction }) => [item.id, otherCharacter.name, direction])).toEqual([
      ['out', '白露', 'outgoing'],
      ['in', '长风', 'incoming'],
      ['mutual', '长风', 'mutual']
    ])
  })

  it('keeps isolated characters selectable with an empty relationship list', () => {
    expect(relationshipsForCharacter(people[2], people, [relationship('ab', 'a', 'b', false)])).toEqual([])
  })

  it('seeds a new relationship from the selected character to a different person', () => {
    expect(newRelationshipForCharacter(people, 'b')).toMatchObject({ fromId: 'b', toId: 'a', type: '', directed: false })
    expect(newRelationshipForCharacter([people[0]], 'a').toId).toBe('')
  })
})
