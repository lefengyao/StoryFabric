import { androidCloudAccount, trailblazerNative } from './capacitorCloudAccount'

interface NativeStream {
  controller?: ReadableStreamDefaultController<Uint8Array>
  pending: Uint8Array[]
  abortCleanup?: () => void
  ended: boolean
}

const streams = new Map<string, NativeStream>()
let listenersReady: Promise<void> | undefined

function ensureListeners(): Promise<void> {
  if (!listenersReady) {
    listenersReady = Promise.all([
      trailblazerNative.addListener('cloudModelChunk', (event) => {
        const id = typeof event.requestId === 'string' ? event.requestId : ''
        const stream = streams.get(id)
        if (!stream || stream.ended || typeof event.chunk !== 'string') return
        const raw = atob(event.chunk)
        const chunk = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i += 1) chunk[i] = raw.charCodeAt(i)
        if (stream.controller) stream.controller.enqueue(chunk)
        else stream.pending.push(chunk)
      }),
      trailblazerNative.addListener('cloudModelEnd', (event) => {
        const id = typeof event.requestId === 'string' ? event.requestId : ''
        const stream = streams.get(id)
        if (!stream || stream.ended) return
        stream.ended = true
        stream.abortCleanup?.()
        streams.delete(id)
        try {
          if (typeof event.error === 'string' && event.error) stream.controller?.error(new Error(event.error))
          else stream.controller?.close()
        } catch { /* the consumer may already have cancelled the stream */ }
      })
    ]).then(() => undefined).catch((error) => {
      listenersReady = undefined
      throw error
    })
  }
  return listenersReady
}

function isManagedGateway(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'trasub2api.fengyao.xin' && url.port === '10048'
      && url.pathname.startsWith('/api/v1/integration/storyfabric/gateway/')
  } catch { return false }
}

function abortError(): DOMException { return new DOMException('Aborted', 'AbortError') }

/** Keeps the Sub2API bearer token in native memory while adapting its streamed response to Fetch. */
export function createCapacitorCloudModelFetch(fallback: typeof fetch): typeof fetch {
  return async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!isManagedGateway(requestUrl)) return fallback(input, init)
    const managedUrl = new URL(requestUrl)
    managedUrl.searchParams.delete('key')

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (signal?.aborted) throw abortError()
    await ensureListeners()

    const random = new Uint8Array(16)
    crypto.getRandomValues(random)
    const requestId = `model_${Array.from(random, (value) => value.toString(16).padStart(2, '0')).join('')}`
    const entry: NativeStream = { pending: [], ended: false }
    streams.set(requestId, entry)
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    headers.delete('authorization')
    headers.delete('x-api-key')
    headers.delete('x-goog-api-key')

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const bodyValue = init?.body ?? (input instanceof Request && method !== 'GET' && method !== 'HEAD' ? await input.clone().text() : undefined)
    if (bodyValue !== undefined && typeof bodyValue !== 'string') {
      streams.delete(requestId)
      throw new Error('安卓托管模型请求暂不支持此请求体类型')
    }

    let rejectAbort!: (error: DOMException) => void
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const abort = (): void => {
      if (!entry.ended) {
        entry.ended = true
        try { entry.controller?.error(abortError()) } catch { /* best effort */ }
        void trailblazerNative.abortModelRequest({ requestId }).catch(() => undefined)
        entry.abortCleanup?.()
        streams.delete(requestId)
      }
      rejectAbort(abortError())
    }
    const onAbort = (): void => abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.abortCleanup = () => signal?.removeEventListener('abort', onAbort)

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        entry.controller = controller
        for (const chunk of entry.pending.splice(0)) controller.enqueue(chunk)
        if (entry.ended) controller.close()
      },
      cancel() { abort() }
    })

    try {
      const start = trailblazerNative.startModelRequest({
        requestId,
        url: managedUrl.href,
        method,
        headers: Object.fromEntries(headers.entries()),
        ...(typeof bodyValue === 'string' ? { body: bodyValue } : {})
      })
      const response = await Promise.race([start, aborted])
      entry.abortCleanup = () => signal?.removeEventListener('abort', onAbort)
      if (response.status === 409) {
        void trailblazerNative.abortModelRequest({ requestId }).catch(() => undefined)
        entry.abortCleanup?.()
        streams.delete(requestId)
        entry.ended = true
        try { entry.controller?.error(new Error('云端连接已更换，请重新开始本次运行')) } catch { /* response was not exposed */ }
        throw new Error('云端连接已更换，请重新开始本次运行')
      }
      const responseHeaders = new Headers(response.headers)
      const responseBody = [204, 205, 304].includes(response.status) ? null : body
      return new Response(responseBody, { status: response.status, headers: responseHeaders })
    } catch (error) {
      entry.abortCleanup?.()
      if (!entry.ended) {
        entry.ended = true
        streams.delete(requestId)
        try { entry.controller?.error(error) } catch { /* response was not exposed */ }
      }
      throw error
    }
  }
}

export { androidCloudAccount }
