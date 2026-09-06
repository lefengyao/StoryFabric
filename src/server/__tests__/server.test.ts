import { mkdtemp, mkdir, rm } from 'node:fs/promises'
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
    const legacy = join(root, 'workspace')
    await mkdir(legacy)
    await initializeWorkspace(new NodeFileStore(legacy), '服务测试')
    const server = createStoryFabricServer({ accessKey: 'server-test-key', dataDir: root, workspaceRoot: legacy })

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

      const listed = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookie ?? '' } })
      expect(listed.status).toBe(200)
      const workspaces = await listed.json() as Array<{ path: string; name: string }>
      expect(workspaces).toMatchObject([{ path: 'default', name: '服务测试' }])

      const opened = await fetch(`${base}/api/workspaces/default/open`, { method: 'POST', headers: { cookie: cookie ?? '' } })
      expect(opened.status).toBe(200)

      const rpc = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookie ?? '' },
        body: JSON.stringify({ method: 'getCurrentWorkspace', args: [] })
      })
      expect(rpc.status).toBe(200)
      const payload = await rpc.json() as { result: { name: string } }
      expect(payload.result.name).toBe('服务测试')

      const downloaded = await fetch(`${base}/api/workspaces/default/archive`, { headers: { cookie: cookie ?? '' } })
      if (!downloaded.ok) throw new Error(await downloaded.text())
      expect(downloaded.status).toBe(200)
      expect(downloaded.headers.get('content-type')).toContain('application/zip')
      const archiveBytes = await downloaded.arrayBuffer()
      const imported = await fetch(`${base}/api/workspaces/import`, {
        method: 'POST',
        headers: { cookie: cookie ?? '', 'content-type': 'application/zip', 'x-storyfabric-workspace-name': encodeURIComponent('导入副本') },
        body: archiveBytes
      })
      expect(imported.status).toBe(201)
      const importedSummary = await imported.json() as { path: string; name: string }
      expect(importedSummary.path).not.toBe('default')

      const tokenResponse = await fetch(`${base}/api/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'server-test-key' })
      })
      const token = (await tokenResponse.json() as { token: string }).token
      expect(token).toBeTruthy()
      expect((await fetch(`${base}/api/workspaces`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
