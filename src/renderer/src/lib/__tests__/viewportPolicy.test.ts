import { expect, it } from 'vitest'
import { resolveViewportPolicy } from '../viewportPolicy'

it('does not mistake the reduced visual height from an open keyboard for a rotation', () => {
  expect(resolveViewportPolicy({ width: 844, height: 390, visualHeight: 180, keyboardOpen: true })).toMatchObject({ mode: 'pc', landscape: true, showGate: false })
})

it('keeps the PC workbench available as a portrait fallback instead of switching to mobile navigation', () => {
  expect(resolveViewportPolicy({ width: 390, height: 844, keyboardOpen: false, usePcFallback: true })).toMatchObject({ mode: 'pc', landscape: false, showGate: false })
})
