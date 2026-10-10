import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { createStoryFabricServer } from '../server'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { exportWorkspaceArchive } from '../../core/workspace/archive'
import { parseFrontMatter } from '../../core/workspace/frontMatter'

it('requires consent for legacy path, registered workspace and ZIP while preserving session and source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-upgrade-http-'))
  const project = join(root, 'workspaces', 'legacy-project')
  await mkdir(project, { recursive: true })
  const store = new NodeFileStore(project)
  const metadata = JSON.stringify({ app: 'storyfabric', version: 4, name: '旧作品' })
  const path = 'chapters/draft/0001-原稿.md'
  const original = '---\nid: cha_legacy\ntitle: 原稿\nbox: draft\nstatus: draft\norder: 1\nvolumeId: vol_default\n---\n\n旧项目的原稿。\n'
  await store.writeText('storyfabric.json', metadata)
  await store.writeText(path, original)
  const archive = await exportWorkspaceArchive(store, '旧作品')
  const server = createStoryFabricServer({ dataDir: root, accessKey: 'upgrade-test' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'upgrade-test' }) })
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]
    const post = (endpoint: string, body: unknown) => fetch(`${base}${endpoint}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const current = async () => (await (await post('/api/rpc', { method: 'getCurrentWorkspace', args: [] })).json() as { result: unknown }).result
    const before = await current()
    const rejected = await post('/api/workspaces/open-path', { path: project })
    expect(rejected.status).toBe(400)
    expect(await rejected.text()).toContain('WORKSPACE_UPGRADE_REQUIRED')
    expect(await store.readText('storyfabric.json')).toBe(metadata)
    expect(await store.readText(path)).toBe(original)
    expect(await current()).toEqual(before)
    const opened = await post('/api/workspaces/open-path', { path: project, upgradeLegacy: true })
    expect(opened.status).toBe(200)
    const summary = await opened.json() as { path: string; version: number }
    expect(summary.version).toBe(5)
    expect(parseFrontMatter((await store.readText(path))!).content).toBe(parseFrontMatter(original).content)
    expect(await store.listDirs('.storyfabric/format-backups')).toHaveLength(1)
    const upgradedCurrent = await current()
    const rejectedZip = await fetch(`${base}/api/workspaces/import`, { method: 'POST', headers: { cookie, 'content-type': 'application/zip' }, body: archive.bytes.slice().buffer as ArrayBuffer })
    expect(rejectedZip.status).toBe(400)
    expect(await rejectedZip.text()).toContain('WORKSPACE_UPGRADE_REQUIRED')
    expect(await current()).toEqual(upgradedCurrent)
    const importedZip = await fetch(`${base}/api/workspaces/import`, { method: 'POST', headers: { cookie, 'content-type': 'application/zip', 'x-storyfabric-upgrade-legacy': 'true' }, body: archive.bytes.slice().buffer as ArrayBuffer })
    expect(importedZip.status).toBe(201)
    expect(await importedZip.json()).toMatchObject({ version: 5 })
    expect(JSON.parse(await readFile(join(project, 'storyfabric.json'), 'utf8')).version).toBe(5)
    await store.writeText('storyfabric.json', metadata)
    await store.writeText(path, original)
    const rejectedRegistered = await post(`/api/workspaces/${summary.path}/open`, {})
    expect(await rejectedRegistered.text()).toContain('WORKSPACE_UPGRADE_REQUIRED')
    const reopened = await post(`/api/workspaces/${summary.path}/open`, { upgradeLegacy: true })
    expect(reopened.status).toBe(200)
    expect(await reopened.json()).toMatchObject({ version: 5, path: summary.path })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
