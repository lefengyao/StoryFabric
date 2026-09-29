import { afterEach, describe, expect, it, vi } from 'vitest'

const nativeFetch = vi.hoisted(() => vi.fn(async () => new Response('{}', { status: 200 })))
vi.mock('electron', () => ({ net: { fetch: nativeFetch } }))

import { configureNetworkLogger, electronFetch } from '../networkFetch'

afterEach(() => configureNetworkLogger(undefined))

describe('desktop provider transport', () => {
  it('routes provider requests through Electron networking with the original headers', async () => {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    const init = { headers: { 'x-goog-api-key': 'redacted' }, redirect: 'error' as const }
    await electronFetch(url, init)
    expect(nativeFetch).toHaveBeenCalledWith(url.href, init)
  })

  it('records request status and content type without recording headers', async () => {
    const logger = { info: vi.fn(async () => undefined), error: vi.fn(async () => undefined) }
    configureNetworkLogger(logger)
    await electronFetch('https://example.test/v1/models', { headers: { Authorization: 'Bearer secret' } })

    expect(logger.info).toHaveBeenCalledWith('network.request.start', { url: 'https://example.test/v1/models' })
    expect(logger.info).toHaveBeenCalledWith('network.request.complete', expect.objectContaining({ status: 200, ok: true, contentType: 'text/plain;charset=UTF-8' }))
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret')
  })
})
