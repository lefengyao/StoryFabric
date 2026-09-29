import { CapacitorHttp } from '@capacitor/core'

type NativeRequest = typeof CapacitorHttp.request

/** Adapt Capacitor's native HTTP transport to the Fetch API used by web-search-kit. */
export function createCapacitorWebFetch(request: NativeRequest = CapacitorHttp.request.bind(CapacitorHttp), readTimeoutMs = 30000): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const call = request({
      url,
      method: init?.method ?? 'GET',
      headers,
      ...(typeof init?.body === 'string' ? { data: init.body } : {}),
      responseType: 'text',
      disableRedirects: init?.redirect === 'error',
      connectTimeout: 30000,
      readTimeout: readTimeoutMs
    })
    let onAbort: (() => void) | undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const result = signal ? await Promise.race([call, cancelled]) : await call
      const body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? '')
      return new Response(body, { status: result.status, headers: result.headers })
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
  }
}
