/** Keep persisted runtime values usable on Android WebViews without newer built-ins. */
export function lastItem<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}

export function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value)
  return cloneFallback(value, new WeakMap()) as T
}

function cloneFallback(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') {
    const error = new Error('The value cannot be cloned')
    error.name = 'DataCloneError'
    throw error
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) {
    const copy = new Date(value.getTime())
    seen.set(value, copy)
    return copy
  }
  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags)
    seen.set(value, copy)
    return copy
  }
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0)
    seen.set(value, copy)
    return copy
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = cloneFallback(value.buffer, seen) as ArrayBuffer
    const copy = value instanceof DataView
      ? new DataView(buffer, value.byteOffset, value.byteLength)
      : new (value.constructor as { new(buffer: ArrayBuffer, byteOffset: number, length: number): ArrayBufferView })(buffer, value.byteOffset, (value as unknown as { length: number }).length)
    seen.set(value, copy)
    return copy
  }
  if (value instanceof Map) {
    const copy = new Map()
    seen.set(value, copy)
    for (const [key, child] of value) copy.set(cloneFallback(key, seen), cloneFallback(child, seen))
    return copy
  }
  if (value instanceof Set) {
    const copy = new Set()
    seen.set(value, copy)
    for (const child of value) copy.add(cloneFallback(child, seen))
    return copy
  }
  if (value instanceof Error) {
    const copy = new Error(value.message)
    copy.name = value.name
    copy.stack = value.stack
    seen.set(value, copy)
    if ('cause' in value) Object.defineProperty(copy, 'cause', { value: cloneFallback(value.cause, seen), configurable: true, writable: true })
    return copy
  }
  if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]') {
    const error = new Error('The value cannot be cloned')
    error.name = 'DataCloneError'
    throw error
  }
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? new Array(value.length) : {}
  seen.set(value, copy)
  for (const key of Object.keys(value)) Object.defineProperty(copy, key, {
    value: cloneFallback((value as Record<string, unknown>)[key], seen), enumerable: true, configurable: true, writable: true
  })
  return copy
}
