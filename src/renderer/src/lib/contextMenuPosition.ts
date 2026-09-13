export interface ContextMenuPosition {
  x: number
  y: number
}

export function clampContextMenuPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  menuWidth = 172,
  menuHeight = 190
): ContextMenuPosition {
  return {
    x: Math.max(8, Math.min(x, Math.max(8, viewportWidth - menuWidth - 8))),
    y: Math.max(8, Math.min(y, Math.max(8, viewportHeight - menuHeight - 8)))
  }
}
