import { describe, expect, it } from 'vitest'
import { canSwitchDocument, shouldFocusEditorOnDocumentSwitch } from '../documentSwitch'

describe('canSwitchDocument', () => {
  it('allows switching from a clean opened document to another document', () => {
    expect(canSwitchDocument({ currentId: 'a', targetId: 'b', dirty: false, confirmDiscard: () => false })).toBe(true)
  })

  it('keeps the current document when the user declines discarding edits', () => {
    expect(canSwitchDocument({ currentId: 'a', targetId: 'b', dirty: true, confirmDiscard: () => false })).toBe(false)
  })

  it('allows switching after the user confirms discarding edits', () => {
    expect(canSwitchDocument({ currentId: 'a', targetId: 'b', dirty: true, confirmDiscard: () => true })).toBe(true)
  })
})

describe('shouldFocusEditorOnDocumentSwitch', () => {
  it('focuses the editor when switching between two existing documents', () => {
    expect(shouldFocusEditorOnDocumentSwitch('character-a', 'character-b')).toBe(true)
  })

  it('does not steal focus on initial mount or when the document is unchanged', () => {
    expect(shouldFocusEditorOnDocumentSwitch('character-a', 'character-a')).toBe(false)
    expect(shouldFocusEditorOnDocumentSwitch(undefined, 'character-a')).toBe(false)
  })
})
