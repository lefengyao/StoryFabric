import { describe, expect, it, vi } from 'vitest'
import { HttpPlatformApi, WebAuthRequiredError } from '../httpApi'

describe('web platform api', () => {
  it('maps StoryFabric calls to authenticated RPC requests', async () => {
    const requests: Array<{ url: string; body: string }> = []
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ result: { name: '服务工作区' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await expect(api.getCurrentWorkspace()).resolves.toEqual({ name: '服务工作区' })
    expect(requests[0].url).toBe('/api/rpc')
    expect(JSON.parse(requests[0].body)).toEqual({ method: 'getCurrentWorkspace', args: [] })
  })

  it('requests recent workspaces from the dedicated endpoint', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const recent = [{ name: '最近工作区', path: 'ws_recent', chapterCount: 1, volumeCount: 0, relationshipCount: 0, lastOpenedAt: '2026-09-11T08:00:00.000Z' }]
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify(recent), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await expect(api.listRecentWorkspaces()).resolves.toEqual(recent)
    expect(requests[0].url).toBe('/api/workspaces/recent')
    expect(requests[0].init?.credentials).toBe('include')
  })

  it('invokes the default browser fetch with the global receiver', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(new Response(JSON.stringify({ result: { name: '默认 fetch' } }), { status: 200 }))
    } as typeof fetch

    try {
      const api = new HttpPlatformApi()
      await expect(api.getCurrentWorkspace()).resolves.toEqual({ name: '默认 fetch' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces an authentication error for expired web sessions', async () => {
    const api = new HttpPlatformApi(async () => new Response(JSON.stringify({ error: '需要登录' }), { status: 401 }))

    await expect(api.getCurrentWorkspace()).rejects.toBeInstanceOf(WebAuthRequiredError)
  })

  it('uploads raw workspace ZIP bytes to the binary endpoint', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ name: '导入副本', path: 'ws_test' }), { status: 201, headers: { 'content-type': 'application/json' } })
    }, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })

    await api.importWorkspace(new Uint8Array([1, 2, 3]), '项目.storyfabric.zip', { name: '导入副本' })
    expect(requests[0].url).toBe('https://server.example/api/workspaces/import')
    expect(requests[0].init?.headers).toMatchObject({ authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/zip' })
    expect(requests[0].init?.body).toBeInstanceOf(ArrayBuffer)
  })

  it('opens a workspace by path with a trimmed JSON POST body', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ name: '路径工作区', path: 'ws_path' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })

    await api.openWorkspaceByPath('  /srv/storyfabric/workspaces/demo  ')

    expect(requests[0].url).toBe('https://server.example/api/workspaces/open-path')
    expect(requests[0].init?.method).toBe('POST')
    expect(requests[0].init?.headers).toMatchObject({ authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json' })
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ path: '/srv/storyfabric/workspaces/demo' })
  })

  it('forwards an AbortSignal to open and import requests', async () => {
    const requests: RequestInit[] = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init) requests.push(init)
      return new Response(JSON.stringify({ name: '工作区', path: 'ws_signal' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const api = new HttpPlatformApi(fetcher, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })
    const controller = new AbortController()

    await api.openWorkspaceByPath('/srv/workspace', { signal: controller.signal })
    await api.importWorkspace(new Uint8Array([1]), 'workspace.storyfabric.zip', undefined, { signal: controller.signal })

    expect(requests[0].signal).toBe(controller.signal)
    expect(requests[1].signal).toBe(controller.signal)
  })

  it('rejects an empty workspace path', async () => {
    const api = new HttpPlatformApi()

    await expect(api.openWorkspaceByPath('  ')).rejects.toThrow('请输入工作区路径')
  })

  it('aborts a bearer SSE request when unsubscribing', async () => {
    let request: RequestInit | undefined
    const api = new HttpPlatformApi(async (_input, init) => {
      request = init
      return new Response(null, { status: 200 })
    }, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })

    const unsubscribe = api.onAgentEvent(() => undefined)
    await Promise.resolve()
    expect(request?.signal?.aborted).toBe(false)
    unsubscribe()
    expect(request?.signal?.aborted).toBe(true)
  })
})
