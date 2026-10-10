import { describe, expect, it } from 'vitest'
import { cloneValue, lastItem } from '../runtimeCompatibility'

describe('runtime compatibility', () => {
  it('reads the final item without Array.at', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'at')!
    let last: number | undefined
    try {
      Object.defineProperty(Array.prototype, 'at', { ...descriptor, value: undefined })
      last = lastItem([1, 2, 3])
    } finally { Object.defineProperty(Array.prototype, 'at', descriptor) }
    expect(last).toBe(3)
    expect(lastItem([])).toBeUndefined()
  })

  it('clones runtime values, repeated references and cycles without native structuredClone', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')!
    const shared = { text: '正文', optional: undefined }
    const bytes = new Uint8Array([1, 2, 3])
    const input = { first: shared, second: shared, date: new Date(123), map: new Map([[shared, bytes]]), set: new Set([shared]), bytes, view: new DataView(bytes.buffer), sparse: new Array(2), self: null as unknown }
    input.self = input
    let copy: typeof input
    try {
      Object.defineProperty(globalThis, 'structuredClone', { ...descriptor, value: undefined })
      copy = cloneValue(input)
    } finally { Object.defineProperty(globalThis, 'structuredClone', descriptor) }
    expect(copy!.first).not.toBe(shared)
    expect(copy!.first).toEqual(shared)
    expect('optional' in copy!.first).toBe(true)
    expect(copy!.second).toBe(copy!.first)
    expect(copy!.self).toBe(copy)
    expect(copy!.date).toEqual(input.date)
    expect(copy!.map.get(copy!.first)).toBe(copy!.bytes)
    expect(copy!.set.has(copy!.first)).toBe(true)
    expect(copy!.bytes).toEqual(bytes)
    expect(copy!.bytes.buffer).not.toBe(bytes.buffer)
    expect(copy!.view.buffer).toBe(copy!.bytes.buffer)
    expect(copy!.sparse).toHaveLength(2)
    expect(0 in copy!.sparse).toBe(false)
  })
})
