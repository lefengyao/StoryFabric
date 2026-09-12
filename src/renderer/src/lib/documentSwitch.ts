export interface DocumentSwitchRequest {
  currentId: string | null | undefined
  targetId: string | null | undefined
  dirty: boolean
  confirmDiscard: () => boolean
}

/** Returns whether a document switch may proceed without silently losing edits. */
export function canSwitchDocument({ currentId, targetId, dirty, confirmDiscard }: DocumentSwitchRequest): boolean {
  if (!targetId || currentId === targetId || !dirty) return true
  return confirmDiscard()
}
