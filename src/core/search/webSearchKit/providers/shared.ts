/**
 * Helpers shared by the search providers: the injectable fetch type, the
 * options-snapshot helper, the cancellation and validation predicates, and the
 * request-rate gate used by the self-hosted providers.
 * Extracted from the repeated local copies in the harness providers.
 * @module web-search-standalone/providers/shared
 */

/** The subset of `fetch` these providers use, injectable for tests and proxies. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Read the options for the next operation. A thunk lets a caller swap
 * configuration (endpoint, key, limits) between searches without re-registering
 * the provider, which would make provider selection observable as a flicker.
 */
export type OptionsSource<T extends object> = T | (() => T)

/**
 * Resolve an {@link OptionsSource} to the options for this operation.
 * @param source - a plain options object or a thunk returning one.
 * @returns the options object.
 */
export function resolveSource<T extends object>(source: OptionsSource<T>): T {
  return typeof source === 'function' ? (source as () => T)() : source
}

/** True for a fetch or `AbortSignal` abort. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * True when the caller cancelled: either the signal is already aborted or the
 * thrown value is an abort error. The harness classified only on error shape,
 * which reported a cancellation carrying a custom reason (for example a timeout
 * reason) as a provider failure; checking the signal first fixes that.
 */
export function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || isAbortError(error)
}

/** True for a request limit that can be sent to a provider (a positive whole number). */
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Attribution header sent on every request. Bump with the package version. */
export const USER_AGENT = 'web-search-standalone/0.1.0'

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
export function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** Resolve after `ms`, or reject as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const fail = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new Error('aborted'))
    }
    const onAbort = (): void => { fail() }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal?.aborted === true) {
      fail()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Bounds the request rate sent to a self-hosted backend.
 *
 * Both self-hosted backends here are resource amplifiers rather than single APIs.
 * A SearXNG instance turns one query into a dozen upstream requests, so a
 * multi-query tool call that fans out concurrently gets the instance's IP
 * CAPTCHAed by Google — which then breaks every later search, including
 * single-query ones. A self-hosted scraper is worse: each extraction may occupy a
 * headless browser, so an unbounded fan-out exhausts the browser pool and every
 * caller starts timing out. Gating here is what makes multi-query calls safe.
 */
export class RequestGate {
  private active = 0
  private lastStartedAt = 0
  private readonly waiters: (() => void)[] = []

  /**
   * @param maxConcurrency - requests allowed in flight at once.
   * @param minIntervalMs - minimum gap between two request start times.
   */
  constructor(private readonly maxConcurrency: number, private readonly minIntervalMs: number) {}

  /**
   * Wait for a slot and for the start-rate gap.
   * @param signal - cancellation; aborts the wait rather than queueing a doomed request.
   * @returns the release function, which is idempotent.
   */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    while (this.active >= this.maxConcurrency) {
      await new Promise<void>(resolve => { this.waiters.push(resolve) })
    }
    this.active += 1
    try {
      await sleep(this.lastStartedAt + this.minIntervalMs - Date.now(), signal)
    } catch (error: unknown) {
      this.active -= 1
      this.wakeOne()
      throw error
    }
    this.lastStartedAt = Date.now()
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      this.wakeOne()
    }
  }

  /** Hand the freed slot to the next waiter, if any. */
  private wakeOne(): void {
    const next = this.waiters.shift()
    if (next !== undefined) next()
  }
}
