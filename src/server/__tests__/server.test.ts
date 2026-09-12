import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest, type ClientRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { initializeWorkspace } from '../../core/workspace/workspaceService'
import { createStoryFabricServer, recordRecentWorkspaceBestEffort } from '../server'
import { ServerSettingsStore } from '../settingsStore'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

describe('linux web server', () => {
  it('contains recent workspace recording failures without changing the operation result', async () => {
    await expect(recordRecentWorkspaceBestEffort(async () => { throw new Error('settings unavailable') })).resolves.toBe(false)
    await expect(recordRecentWorkspaceBestEffort(async () => undefined)).resolves.toBe(true)
  })

  it('rolls back an imported workspace when the client disconnects after registry publish', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-import-cancel-'))
    const server = createStoryFabricServer({ accessKey: 'import-cancel-test-key', dataDir: root })
    const entered = deferred<void>()
    const release = deferred<void>()
    const record = vi.spyOn(ServerSettingsStore.prototype, 'recordRecentWorkspace').mockImplementation(async () => {
      entered.resolve()
      await release.promise
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'import-cancel-test-key' })
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
      const archive = await fetch(`${base}/api/workspaces/default/archive`, { headers: { cookie } })
      const body = Buffer.from(await archive.arrayBuffer())
      let clientRequest: ClientRequest | null = null
      const importing = new Promise<void>((resolve, reject) => {
        clientRequest = httpRequest(`${base}/api/workspaces/import`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/zip', 'content-length': body.length }
        }, (response) => {
          response.resume()
          response.once('end', resolve)
        })
        clientRequest.once('error', reject)
        clientRequest.end(body)
      })

      await entered.promise
      clientRequest!.destroy()
      await new Promise((resolve) => setImmediate(resolve))
      release.resolve()
      await expect(importing).rejects.toThrow()

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const persisted = JSON.parse(await readFile(join(root, 'workspaces', 'registry.json'), 'utf8')) as { workspaces: Array<{ id: string }> }
        const leftovers = (await readdir(join(root, 'workspaces'))).filter((name) => name.startsWith('ws_'))
        if (persisted.workspaces.every((workspace) => workspace.id === 'default') && leftovers.length === 0) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const persisted = JSON.parse(await readFile(join(root, 'workspaces', 'registry.json'), 'utf8')) as { workspaces: Array<{ id: string }> }
      expect(persisted.workspaces.map((workspace) => workspace.id)).toEqual(['default'])
      expect((await readdir(join(root, 'workspaces'))).filter((name) => name.startsWith('ws_'))).toEqual([])
    } finally {
      record.mockRestore()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

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

      await Promise.all(['并发卷 A', '并发卷 B'].map(async (title) => {
        const response = await fetch(`${base}/api/rpc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: cookie ?? '' },
          body: JSON.stringify({ method: 'saveVolume', args: [{ title }] })
        })
        expect(response.status).toBe(200)
      }))
      const volumesResponse = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookie ?? '' },
        body: JSON.stringify({ method: 'listVolumes', args: [] })
      })
      const volumes = (await volumesResponse.json() as { result: Array<{ title: string }> }).result
      expect(volumes.map((volume) => volume.title)).toEqual(expect.arrayContaining(['并发卷 A', '并发卷 B']))

      // 每模型参数要能经 RPC 保存并读回，且随模型列表清理失效项
      const savedProvider = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookie ?? '' },
        body: JSON.stringify({
          method: 'saveProvider',
          args: [
            {
              name: '网页供应商',
              protocol: 'openai',
              baseUrl: 'https://api.test/v1',
              apiKey: 'sk-web',
              models: ['gpt-4o', 'claude-x'],
              modelSettings: {
                'gpt-4o': {
                  reasoningSupport: true,
                  vision: true,
                  reasoning: 'medium',
                  reasoningMap: { path: 'thinking.type', values: { medium: 'enabled' } },
                  contextTokens: 131072,
                  maxOutputTokens: 8192
                },
                '已移除的模型': { reasoning: 'low' }
              }
            }
          ]
        })
      })
      expect(savedProvider.status).toBe(200)
      const settingsPayload = (await savedProvider.json() as { result: { providers: Array<{ name: string; modelSettings: Record<string, unknown> }> } }).result
      expect(settingsPayload.providers.find((provider) => provider.name === '网页供应商')?.modelSettings).toEqual({
        'gpt-4o': {
          reasoningSupport: true,
          vision: true,
          reasoning: 'medium',
          reasoningMap: { path: 'thinking.type', values: { medium: 'enabled' } },
          contextTokens: 131072,
          maxOutputTokens: 8192
        }
      })

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
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('returns authenticated recent lightweight workspaces and updates order after open and import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-recent-server-'))
    const legacy = join(root, 'workspace')
    await mkdir(legacy)
    await initializeWorkspace(new NodeFileStore(legacy), '服务测试')
    const server = createStoryFabricServer({ accessKey: 'recent-server-test-key', dataDir: root, workspaceRoot: legacy })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      expect((await fetch(`${base}/api/workspaces/recent`)).status).toBe(401)

      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'recent-server-test-key' })
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

      const opened = await fetch(`${base}/api/workspaces/default/open`, { method: 'POST', headers: { cookie } })
      expect(opened.status).toBe(200)
      const created = await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: '新建工作区' })
      })
      expect(created.status).toBe(201)
      const createdSummary = await created.json() as { path: string }
      expect(createdSummary.path).toMatch(/^ws_[a-z0-9]{12}$/)

      const reopened = await fetch(`${base}/api/workspaces/default/open`, { method: 'POST', headers: { cookie } })
      expect(reopened.status).toBe(200)
      const afterReopen = await fetch(`${base}/api/workspaces/recent`, { headers: { cookie } })
      const reopenedItems = await afterReopen.json() as Array<{ name: string; path: string; chapterCount: number; volumeCount: number; relationshipCount: number; lastOpenedAt?: string }>
      expect(afterReopen.status).toBe(200)
      expect(reopenedItems.slice(0, 2).map((item) => item.path)).toEqual(['default', createdSummary.path])
      expect(reopenedItems[0]).toMatchObject({ name: '服务测试', path: 'default', chapterCount: expect.any(Number), volumeCount: expect.any(Number), relationshipCount: expect.any(Number) })
      expect(reopenedItems[0].lastOpenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const archive = await fetch(`${base}/api/workspaces/default/archive`, { headers: { cookie } })
      const imported = await fetch(`${base}/api/workspaces/import`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/zip', 'x-storyfabric-workspace-name': encodeURIComponent('导入副本') },
        body: await archive.arrayBuffer()
      })
      expect(imported.status).toBe(201)
      const importedSummary = await imported.json() as { path: string }
      expect(importedSummary.path).toMatch(/^ws_[a-z0-9]{12}$/)

      const afterImport = await fetch(`${base}/api/workspaces/recent`, { headers: { cookie } })
      const importedItems = await afterImport.json() as Array<{ name: string; path: string; lastOpenedAt?: string }>
      expect(importedItems.slice(0, 3).map((item) => item.path)).toEqual([importedSummary.path, 'default', createdSummary.path])
      expect(importedItems[0]).toMatchObject({ name: '导入副本', path: importedSummary.path })
      expect(importedItems[0].lastOpenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(JSON.stringify(importedItems)).not.toContain(root)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('returns each recent workspace path only once when settings contain duplicate paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-recent-duplicates-'))
    const settingsPath = join(root, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      recentWorkspaces: ['default', 'default', 'missing'],
      recentWorkspaceOpenedAt: {
        default: '2026-09-11T08:00:00.000Z'
      }
    }))
    const server = createStoryFabricServer({ accessKey: 'recent-duplicates-test-key', dataDir: root, settingsPath })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'recent-duplicates-test-key' })
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

      const response = await fetch(`${base}/api/workspaces/recent`, { headers: { cookie } })
      expect(response.status).toBe(200)
      const recent = await response.json() as Array<{ path: string }>
      expect(recent.map((item) => item.path)).toEqual(['default'])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('keeps workspace operations successful and binds the session only after recent recording fails safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-recent-failure-'))
    const settingsPath = join(root, 'settings.json')
    await writeFile(settingsPath, '{"recentWorkspaces": [}')
    const server = createStoryFabricServer({ accessKey: 'recent-failure-test-key', dataDir: root, settingsPath })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'recent-failure-test-key' })
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

      const created = await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: '记录失败仍创建' })
      })
      expect(created.status).toBe(201)
      const createdSummary = await created.json() as { path: string }

      const currentAfterCreate = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'getCurrentWorkspace', args: [] })
      })
      expect(currentAfterCreate.status).toBe(200)
      expect((await currentAfterCreate.json() as { result: { path: string } }).result.path).toBe(createdSummary.path)

      const rpcCreated = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'createWorkspace', args: ['', 'RPC 创建'] })
      })
      expect(rpcCreated.status).toBe(200)
      const rpcCreatedPath = (await rpcCreated.json() as { result: string }).result
      const currentAfterRpcCreate = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'getCurrentWorkspace', args: [] })
      })
      expect((await currentAfterRpcCreate.json() as { result: { path: string } }).result.path).toBe(rpcCreatedPath)

      const rpcOpened = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'openWorkspace', args: ['default'] })
      })
      expect(rpcOpened.status).toBe(200)

      const openedByPath = await fetch(`${base}/api/workspaces/open-path`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ path: join(root, 'workspaces', 'default') })
      })
      expect(openedByPath.status).toBe(200)

      const archive = await fetch(`${base}/api/workspaces/default/archive`, { headers: { cookie } })
      const imported = await fetch(`${base}/api/workspaces/import`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/zip' },
        body: await archive.arrayBuffer()
      })
      expect(imported.status).toBe(201)

      const currentAfterImport = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'getCurrentWorkspace', args: [] })
      })
      const importedSummary = await imported.json() as { path: string }
      expect((await currentAfterImport.json() as { result: { path: string } }).result.path).toBe(importedSummary.path)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('serves the web login shell before authentication while keeping APIs protected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-static-'))
    const staticDir = join(root, 'web')
    await mkdir(staticDir)
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>StoryFabric</title>')
    const server = createStoryFabricServer({ accessKey: 'static-test-key', dataDir: join(root, 'data'), staticDir })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      const page = await fetch(`${base}/`)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('StoryFabric')
      expect((await fetch(`${base}/api/rpc`, { method: 'POST' })).status).toBe(401)

      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'static-test-key' })
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
      expect((await fetch(`${base}/api/workspaces`, { headers: { cookie } })).status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects encoded traversal attempts against the static root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-static-traversal-'))
    const staticDir = join(root, 'web')
    await mkdir(staticDir)
    await writeFile(join(root, 'settings.json'), '{"apiKeyEncrypted":"must-not-leak"}')
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>StoryFabric</title>')
    const server = createStoryFabricServer({ accessKey: 'static-traversal-key', dataDir: join(root, 'data'), staticDir })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'static-traversal-key' })
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
      expect((await fetch(`${base}/api/workspaces`, { headers: { cookie } })).status).toBe(200)
      for (const path of ['/%2e%2e%2fsettings.json', '/..%2fsettings.json']) {
        const response = await fetch(`${base}${path}`)
        expect(response.status).toBe(403)
        expect(await response.text()).not.toContain('must-not-leak')
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('returns a client error for malformed cookie and workspace URL without terminating the server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-malformed-url-'))
    const server = createStoryFabricServer({ accessKey: 'malformed-test-key', dataDir: root })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      expect((await fetch(`${base}/api/auth/session`, { headers: { cookie: 'storyfabric_session=%' } })).status).toBe(200)
      const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'malformed-test-key' }) })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
      expect((await fetch(`${base}/api/workspaces/%ZZ/open`, { method: 'POST', headers: { cookie } })).status).toBe(400)
      expect((await fetch(`${base}/healthz`)).status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens a managed workspace by server path, rejects invalid paths, and binds the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-open-path-'))
    const managedRoot = join(root, 'workspaces')
    const workspacePath = join(managedRoot, 'from-disk')
    const outsidePath = join(root, 'outside')
    await mkdir(workspacePath, { recursive: true })
    await mkdir(outsidePath, { recursive: true })
    await initializeWorkspace(new NodeFileStore(workspacePath), '路径工作区')
    await initializeWorkspace(new NodeFileStore(outsidePath), '越界工作区')
    const server = createStoryFabricServer({ accessKey: 'open-path-test-key', dataDir: root })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const address = server.address() as AddressInfo
      const base = `http://127.0.0.1:${address.port}`
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'open-path-test-key' })
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

      const opened = await fetch(`${base}/api/workspaces/open-path`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ path: `  ${workspacePath}  ` })
      })
      expect(opened.status).toBe(200)
      const summary = await opened.json() as { path: string; name: string }
      expect(summary).toMatchObject({ name: '路径工作区' })
      expect(summary.path).not.toBe(workspacePath)
      expect(summary.path).toMatch(/^ws_[a-z0-9]{12}$/)

      const rpc = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'getCurrentWorkspace', args: [] })
      })
      expect(rpc.status).toBe(200)
      expect((await rpc.json() as { result: { path: string; name: string } }).result).toMatchObject({ path: summary.path, name: '路径工作区' })

      const outside = await fetch(`${base}/api/workspaces/open-path`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ path: outsidePath })
      })
      expect(outside.status).toBe(400)

      const invalid = await fetch(`${base}/api/workspaces/open-path`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ path: '   ' })
      })
      expect(invalid.status).toBe(400)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
