import { describe, expect, it } from 'vitest'
import { legacyModalPositionStyle } from '../modalPosition'

describe('legacyModalPositionStyle', () => {
  it('uses transform positioning for WebView 83 instead of independent translate', () => {
    expect(legacyModalPositionStyle).toEqual({
      transform: 'translate(-50%, -50%)',
      translate: 'none'
    })
  })
})
