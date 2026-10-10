import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import { createStoryFabricServer } from '../server'
import * as updates from '../../shared/updates'

it('checks updates using the server version before a workspace is selected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storyfabric-update-rpc-'))
  const check = vi.spyOn(updates, 'checkForUpdates').mockResolvedValue({ status: 'empty', currentVersion: '0.2.26', platform: 'linux', checkedAt: 0, issues: [] })
  const server = createStoryFabricServer({ accessKey: 'update-test-key', dataDir: root })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'update-test-key' }) })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const rpc = async (method: string, args: unknown[] = []) => {
      const response = await fetch(`${base}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ method, args }) })
      expect(response.status).toBe(200)
      return (await response.json() as { result: unknown }).result
    }
    await rpc('updateSettings', [{ updatePreferences: { automatic: false, sources: ['https://example.org/download'] } }])
    expect(await rpc('checkAppUpdate')).toMatchObject({ status: 'empty', platform: 'linux' })
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ platform: 'linux', preferences: { automatic: false, sources: ['https://example.org/download'] } }))
  } finally {
    check.mockRestore()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
