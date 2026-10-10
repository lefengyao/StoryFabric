/** Compact composers grow with the draft while reserving most of the column for conversation. */
export function chatInputHeight(contentHeight: number, minimumHeight: number, columnHeight: number): number {
  const maximumHeight = Math.max(minimumHeight, Math.min(96, Math.floor(columnHeight * 0.18)))
  return Math.ceil(Math.max(minimumHeight, Math.min(contentHeight, maximumHeight)))
}
