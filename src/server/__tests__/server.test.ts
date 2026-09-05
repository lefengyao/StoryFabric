import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { initializeWorkspace } from '../../core/workspace/workspaceService'
import { createStoryFabricServer } from '../server'

describe('linux web server', () => {
  it('protects workspace RPC behind the access-key session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-server-'))
    const server = createStoryFabricServer({ accessKey: 'server-test-key', workspaceRoot: root })
    await initializeWorkspace(new NodeFileStore(root), '服务测试')

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      expect((await fetch(`${base}/healthz`)).status).toBe(200)
      expect((await fetch(`${base}/api/rpc`, { method: 'POST' })).status).toBe(401)

      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'server-test-key' })
      })
      expect(login.status).toBe(200)
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
      expect(cookie).toMatch(/^storyfabric_session=/)

      const rpc = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookie ?? '' },
        body: JSON.stringify({ method: 'getCurrentWorkspace', args: [] })
      })
      expect(rpc.status).toBe(200)
      const payload = await rpc.json() as { result: { name: string } }
      expect(payload.result.name).toBe('服务测试')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
