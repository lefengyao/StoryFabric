import { describe, expect, it } from 'vitest'
import { clampContextMenuPosition } from '../contextMenuPosition'

describe('clampContextMenuPosition', () => {
  it('keeps the menu inside the viewport', () => {
    expect(clampContextMenuPosition(900, 700, 800, 600)).toEqual({ x: 620, y: 402 })
  })

  it('keeps a minimum margin at the top-left edge', () => {
    expect(clampContextMenuPosition(-20, -10, 800, 600)).toEqual({ x: 8, y: 8 })
  })
})
