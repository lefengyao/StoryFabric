export interface TimelineTextItem {
  kind: 'text'
  id: string
  text: string
  messageId?: string
}

export function appendTextDelta<T extends { kind: string; id?: string; text?: string; messageId?: string }>(items: T[], messageId: string, delta: string): T[] {
  const stableId = `live_${messageId}`
  const index = items.findIndex((item) => item.kind === 'text' && (item.messageId === messageId || item.id === stableId))
  if (index >= 0) {
    return items.map((item, itemIndex) => itemIndex === index ? { ...item, text: `${item.text ?? ''}${delta}`, messageId } : item)
  }
  return [...items, { kind: 'text', id: stableId, messageId, text: delta } as T]
}
