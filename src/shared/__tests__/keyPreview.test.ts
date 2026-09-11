import { describe, expect, it } from 'vitest'
import { keyPreview } from '../keyPreview'

describe('secret key preview', () => {
  it('never exposes a short key in full', () => {
    expect(keyPreview('12345678')).toBe('12****')
    expect(keyPreview('sk-short')).toBe('sk****')
    expect(keyPreview('sk-123456789')).toBe('sk-1****6789')
  })
})
