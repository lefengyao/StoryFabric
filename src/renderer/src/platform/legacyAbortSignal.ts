function abortWithReason(controller: AbortController, reason: unknown): void {
  // Chromium 83 ignores abort(reason) and does not expose signal.reason.
  if (!('reason' in controller.signal)) Object.defineProperty(controller.signal, 'reason', { value: reason, configurable: true })
  controller.abort(reason)
}

if (typeof AbortSignal.timeout !== 'function') {
  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true, writable: true,
    value: (milliseconds: number): AbortSignal => {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new RangeError('Invalid timeout')
      const controller = new AbortController()
      setTimeout(() => abortWithReason(controller, new DOMException('The operation timed out', 'TimeoutError')), milliseconds)
      return controller.signal
    }
  })
}

if (typeof AbortSignal.any !== 'function') {
  Object.defineProperty(AbortSignal, 'any', {
    configurable: true, writable: true,
    value: (signals: AbortSignal[]): AbortSignal => {
      const controller = new AbortController()
      const aborted = signals.find((signal) => signal.aborted)
      const abort = (signal: AbortSignal): void => abortWithReason(controller, 'reason' in signal ? signal.reason : new DOMException('The operation was aborted', 'AbortError'))
      if (aborted) {
        abort(aborted)
        return controller.signal
      }
      const handlers = new Map<AbortSignal, () => void>()
      for (const signal of new Set(signals)) {
        const handler = (): void => {
          for (const [source, listener] of handlers) source.removeEventListener('abort', listener)
          handlers.clear()
          abort(signal)
        }
        handlers.set(signal, handler)
        signal.addEventListener('abort', handler, { once: true })
      }
      return controller.signal
    }
  })
}

export {}
