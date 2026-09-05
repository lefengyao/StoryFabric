import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from '../archiveTransfer'

describe('archive transfer helpers', () => {
  it('round trips arbitrary archive bytes without corruption', () => {
    const input = new Uint8Array([0, 1, 2, 127, 128, 200, 254, 255])
    expect(base64ToBytes(bytesToBase64(input))).toEqual(input)
  })
})
