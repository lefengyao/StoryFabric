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
})
