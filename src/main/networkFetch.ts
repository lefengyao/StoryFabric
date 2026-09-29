import { net, session } from 'electron'
import type { AppLogger } from './appLogger'

type NetworkLogger = Pick<AppLogger, 'info' | 'error'>

let networkLogger: NetworkLogger | undefined

export function configureNetworkLogger(logger?: NetworkLogger): void {
  networkLogger = logger
}

function logNetwork(level: 'info' | 'error', event: string, details: Record<string, unknown>): void {
  const logger = networkLogger
  if (!logger) return
  void logger[level](event, details).catch(() => {})
}

/** Make Chromium requests follow the operating system proxy configuration. */
export function configureSystemProxy(): Promise<void> {
  return session.defaultSession.setProxy({ mode: 'system' })
}

/** Use Chromium's network stack so desktop provider calls follow the system proxy. */
export const electronFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const startedAt = Date.now()
  logNetwork('info', 'network.request.start', { url })
  try {
    const response = await net.fetch(url, init)
    logNetwork('info', 'network.request.complete', {
      url,
      finalUrl: response.url || undefined,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') ?? undefined,
      durationMs: Date.now() - startedAt
    })
    return response
  } catch (error) {
    logNetwork('error', 'network.request.error', {
      url,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}
