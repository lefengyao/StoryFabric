import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { createStoryFabricServer } from '../server'
import { initializeWorkspace } from '../../core/workspace/workspaceService'
import { NodeFileStore } from '../../core/storage/nodeFileStore'

it('persists writing words through the authenticated web API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storyfabric-writing-rpc-'))
  const workspaceRoot = join(root, 'workspace')
  await initializeWorkspace(new NodeFileStore(workspaceRoot), '写作词表')
  const server = createStoryFabricServer({ accessKey: 'writing-test-key', dataDir: root, workspaceRoot })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'writing-test-key' }) })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const rpc = async (method: string, args: unknown[] = []) => {
      const response = await fetch(base + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ method, args }) })
      expect(response.status).toBe(200)
      return (await response.json() as { result: unknown }).result
    }
    await rpc('openWorkspace', ['default'])
    expect(await rpc('getWritingTools')).toEqual({ customWords: [], hiddenWords: [] })
    await rpc('saveWritingTools', [{ customWords: [' 灵剑 ', '灵剑'], hiddenWords: ['角色'] }])
    expect(await rpc('getWritingTools')).toEqual({ customWords: ['灵剑'], hiddenWords: ['角色'] })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
