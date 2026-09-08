import { describe, expect, it } from 'vitest'
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
