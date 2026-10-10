import type { CharacterDoc, Relationship } from '../../../../shared/types'

export interface CharacterRelationshipItem {
  relationship: Relationship
  otherCharacter: CharacterDoc
  direction: 'outgoing' | 'incoming' | 'mutual'
}

export function relationshipsForCharacter(
  character: CharacterDoc,
  characters: CharacterDoc[],
  relationships: Relationship[]
): CharacterRelationshipItem[] {
  const charactersById = new Map(characters.map((person) => [person.id, person]))
  const items: CharacterRelationshipItem[] = []
  for (const relationship of relationships) {
    const outgoing = relationship.fromId === character.id
    const incoming = relationship.toId === character.id
    if (!outgoing && !incoming) continue
    const otherCharacter = charactersById.get(outgoing ? relationship.toId : relationship.fromId)
    if (!otherCharacter) continue
    items.push({
      relationship,
      otherCharacter,
      direction: !relationship.directed ? 'mutual' : outgoing ? 'outgoing' : 'incoming'
    })
  }
  return items
}

export function newRelationshipForCharacter(characters: CharacterDoc[], characterId?: string): Relationship {
  const fromId = characterId ?? characters[0]?.id ?? ''
  return {
    id: '',
    fromId,
    toId: characters.find((character) => character.id !== fromId)?.id ?? '',
    type: '',
    label: '',
    description: '',
    directed: false
  }
}
