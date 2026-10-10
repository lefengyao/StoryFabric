import { afterEach, describe, expect, it, vi } from 'vitest'

const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!
const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!

afterEach(() => {
  Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor)
  Object.defineProperty(AbortSignal, 'any', anyDescriptor)
  vi.useRealTimers()
  vi.resetModules()
})

async function loadWithoutNativeMethods(): Promise<void> {
  Object.defineProperty(AbortSignal, 'timeout', { ...timeoutDescriptor, value: undefined })
  Object.defineProperty(AbortSignal, 'any', { ...anyDescriptor, value: undefined })
  await import('../legacyAbortSignal')
}

describe('legacy Android cancellation APIs', () => {
  it('aborts a timeout with TimeoutError after its deadline', async () => {
    vi.useFakeTimers()
    await loadWithoutNativeMethods()
    const signal = AbortSignal.timeout(100)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(100)
    expect(signal.aborted).toBe(true)
    expect(signal.reason.name).toBe('TimeoutError')
  })

  it('forwards the first cancellation and removes unused listeners', async () => {
    await loadWithoutNativeMethods()
    const first = new AbortController()
    const second = new AbortController()
    const remove = vi.spyOn(second.signal, 'removeEventListener')
    const signal = AbortSignal.any([first.signal, second.signal])
    first.abort('cancelled')
    second.abort('later')
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe('cancelled')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('recognizes already cancelled input without attaching listeners', async () => {
    await loadWithoutNativeMethods()
    const first = new AbortController()
    const cancelled = new AbortController()
    const add = vi.spyOn(first.signal, 'addEventListener')
    cancelled.abort('done')
    const signal = AbortSignal.any([first.signal, cancelled.signal])
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe('done')
    expect(add).not.toHaveBeenCalled()
  })

  it('preserves a null reason and provides a reason on older signals', async () => {
    await loadWithoutNativeMethods()
    const cancelled = new AbortController()
    cancelled.abort(null)
    expect(AbortSignal.any([cancelled.signal]).reason).toBeNull()
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!
    try {
      delete (AbortSignal.prototype as { reason?: unknown }).reason
      const signal = AbortSignal.timeout(0)
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      expect(signal.aborted).toBe(true)
      expect(signal.reason.name).toBe('TimeoutError')
    } finally { Object.defineProperty(AbortSignal.prototype, 'reason', descriptor) }
  })
})
