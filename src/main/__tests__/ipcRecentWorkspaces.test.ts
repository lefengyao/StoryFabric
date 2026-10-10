import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc'
import { SettingsService } from '../services/settingsService'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { initializeWorkspace } from '../../core/workspace/workspaceService'
import { exportWorkspaceArchive } from '../../core/workspace/archive'

const handlers = new Map<string, (...args: any[]) => unknown>()

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

describe('主进程近期工作区 IPC', () => {
  beforeEach(() => handlers.clear())

  it.each([IPC.OpenWorkspace, IPC.OpenWorkspaceByPath])('backs up a legacy project only with consent and commits active state after success: %s', async (channel) => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-upgrade-'))
    try {
      const workspace = join(root, 'legacy')
      await mkdir(workspace)
      const store = new NodeFileStore(workspace)
      const original = '---\nid: cha_legacy\ntitle: 原稿\norder: 1\nbox: draft\nstatus: draft\n---\n\n原稿正文。\n'
      await store.writeText('storyfabric.json', '{"app":"storyfabric","version":4,"name":"旧项目"}')
      await store.writeText('chapters/draft/0001-原稿.md', original)
      const settings = new SettingsService(join(root, 'settings.json'))
      const { registerIpc } = await import('../ipc')
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never })
      await handlers.get(IPC.CloseWorkspace)!(null)
      await expect(handlers.get(channel)!(null, workspace)).rejects.toThrow('WORKSPACE_UPGRADE_REQUIRED')
      expect((await settings.load()).lastWorkspacePath).toBeUndefined()
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toBeNull()
      expect(await store.readText('chapters/draft/0001-原稿.md')).toBe(original)
      await expect(handlers.get(channel)!(null, workspace, 'consented-upgrade', true)).resolves.toMatchObject({ name: '旧项目', version: 5 })
      expect((await settings.load()).lastWorkspacePath).toBe(workspace)
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toMatchObject({ path: workspace })
      const backups = await store.listDirs('.storyfabric/format-backups')
      expect(backups).toHaveLength(1)
      expect(await store.readText(`.storyfabric/format-backups/${backups[0]}/chapters/draft/0001-原稿.md`)).toBe(original)
    } finally {
      await handlers.get(IPC.CloseWorkspace)?.(null)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('can rename a project and forget it without deleting its folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-recent-actions-'))
    try {
      const workspace = join(root, 'folder-name')
      await mkdir(workspace)
      await initializeWorkspace(new NodeFileStore(workspace), '原项目名')
      const settingsFile = join(root, 'settings.json')
      const settings = new SettingsService(settingsFile)
      await settings.recordRecentWorkspace(workspace)
      const { registerIpc } = await import('../ipc')
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never })

      const renamed = await handlers.get(IPC.RenameWorkspace)!(null, workspace, '新的项目名') as { name: string; path: string }
      expect(renamed).toMatchObject({ name: '新的项目名', path: workspace })
      expect(((await handlers.get(IPC.ListRecentWorkspaces)!()) as Array<{ name: string }>).map((item) => item.name)).toContain('新的项目名')
      await handlers.get(IPC.ForgetRecentWorkspace)!(null, workspace)
      expect((await settings.load()).recentWorkspaces).not.toContain(workspace)
      expect((await settings.load()).lastWorkspacePath).toBeUndefined()
      await expect(access(join(workspace, 'storyfabric.json'))).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    { recentWorkspaces: null, recentWorkspaceOpenedAt: null },
    { recentWorkspaces: 'legacy-workspace', recentWorkspaceOpenedAt: [] },
    { recentWorkspaces: { path: 'legacy-workspace' }, recentWorkspaceOpenedAt: 'legacy-time' },
    { recentWorkspaces: [null, 42, { path: 'legacy-workspace' }], recentWorkspaceOpenedAt: { broken: null } }
  ])('设置中的 recent 字段为异常形状时 listRecentWorkspaces 不抛错 %#', async (malformed) => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-ipc-settings-'))
    try {
      const file = join(dir, 'settings.json')
      await writeFile(file, JSON.stringify(malformed), 'utf-8')
      const { registerIpc } = await import('../ipc')
      registerIpc({
        win: () => null,
        settings: new SettingsService(file),
        agent: {} as never,
        usage: {} as never
      })

      const handler = handlers.get(IPC.ListRecentWorkspaces)
      expect(handler).toBeDefined()
      await expect(handler!()).resolves.toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cancels an in-flight open before it commits currentRoot or recent settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-cancel-'))
    try {
      const workspace = join(root, 'workspace')
      await mkdir(workspace)
      await initializeWorkspace(new NodeFileStore(workspace), '可取消工作区')
      const settingsFile = join(root, 'settings.json')
      const settings = new SettingsService(settingsFile)
      const entered = deferred<void>()
      const release = deferred<void>()
      const record = vi.spyOn(settings, 'recordRecentWorkspace').mockImplementation(async (path, signal) => {
        entered.resolve()
        await release.promise
        return SettingsService.prototype.recordRecentWorkspace.call(settings, path, signal)
      })
      const { registerIpc } = await import('../ipc')
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never })

      const open = handlers.get(IPC.OpenWorkspaceByPath)!(null, workspace, 'cancel-open-1') as Promise<unknown>
      await entered.promise
      await handlers.get(IPC.CancelWorkspaceRequest)! (null, 'cancel-open-1')
      release.resolve()

      await expect(open).rejects.toMatchObject({ name: 'AbortError' })
      expect(record).toHaveBeenCalledOnce()
      expect((await settings.load()).lastWorkspacePath).toBeUndefined()
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cancels an in-flight import and removes its published directory before committing state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-import-cancel-'))
    try {
      const source = join(root, 'source')
      const parent = join(root, 'imports')
      await mkdir(source)
      await mkdir(parent)
      await initializeWorkspace(new NodeFileStore(source), '导入源')
      const archive = await exportWorkspaceArchive(new NodeFileStore(source), '导入源')
      const settingsFile = join(root, 'settings.json')
      const settings = new SettingsService(settingsFile)
      const entered = deferred<void>()
      const release = deferred<void>()
      vi.spyOn(settings, 'recordRecentWorkspace').mockImplementation(async (path, signal) => {
        entered.resolve()
        await release.promise
        return SettingsService.prototype.recordRecentWorkspace.call(settings, path, signal)
      })
      const { registerIpc } = await import('../ipc')
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never })

      const importing = handlers.get(IPC.ImportWorkspace)!(null, archive.bytes, '导入源.storyfabric.zip', { parentDir: parent, name: '取消导入' }, 'cancel-import-1') as Promise<unknown>
      await entered.promise
      await handlers.get(IPC.CancelWorkspaceRequest)!(null, 'cancel-import-1')
      release.resolve()

      await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
      expect((await settings.load()).lastWorkspacePath).toBeUndefined()
      await expect(access(join(parent, '取消导入'))).rejects.toThrow()
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a successful import when the optional recent workspace write fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-import-recent-failure-'))
    try {
      await handlers.get(IPC.CloseWorkspace)?.(null)
      const source = join(root, 'source')
      const parent = join(root, 'imports')
      await mkdir(source)
      await mkdir(parent)
      await initializeWorkspace(new NodeFileStore(source), '导入源')
      const archive = await exportWorkspaceArchive(new NodeFileStore(source), '导入源')
      const settings = new SettingsService(join(root, 'settings.json'))
      const record = vi.spyOn(settings, 'recordRecentWorkspace').mockRejectedValue(new Error('设置暂不可用'))
      const { registerIpc } = await import('../ipc')
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never })

      const imported = await handlers.get(IPC.ImportWorkspace)!(null, archive.bytes, '导入源.storyfabric.zip', { parentDir: parent, name: '保留导入' })

      expect(imported).toMatchObject({ name: '保留导入', path: join(parent, '保留导入') })
      expect(record).toHaveBeenCalledOnce()
      await expect(access(join(parent, '保留导入', 'storyfabric.json'))).resolves.toBeUndefined()
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toMatchObject({ path: join(parent, '保留导入') })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cancellation during imported summary preserves the previous desktop startup path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-import-summary-cancel-'))
    let summarySpy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const source = join(root, 'source')
      const parent = join(root, 'imports')
      await mkdir(source)
      await mkdir(parent)
      await initializeWorkspace(new NodeFileStore(source), '原工作区')
      const archive = await exportWorkspaceArchive(new NodeFileStore(source), '原工作区')
      const settings = new SettingsService(join(root, 'settings.json'))
      const { registerIpc } = await import('../ipc')
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never })
      await handlers.get(IPC.CloseWorkspace)!(null)
      await handlers.get(IPC.OpenWorkspace)!(null, source)
      const entered = deferred<void>()
      const release = deferred<void>()
      const services = await import('../services/workspaceService')
      const originalLoad = services.loadSummary
      const target = join(parent, '取消导入')
      summarySpy = vi.spyOn(services, 'loadSummary').mockImplementation(async (path, options) => {
        if (path === target) { entered.resolve(); await release.promise }
        return originalLoad(path, options)
      })
      const importing = handlers.get(IPC.ImportWorkspace)!(null, archive.bytes, archive.fileName, { parentDir: parent, name: '取消导入' }, 'cancel-summary-import') as Promise<unknown>
      await entered.promise
      await handlers.get(IPC.CancelWorkspaceRequest)!(null, 'cancel-summary-import')
      release.resolve()
      await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
      expect((await settings.load()).lastWorkspacePath).toBe(source)
      expect((await settings.load()).recentWorkspaces).not.toContain(target)
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toMatchObject({ path: source })
      await expect(access(target)).rejects.toThrow()
    } finally {
      summarySpy?.mockRestore()
      await handlers.get(IPC.CloseWorkspace)?.(null)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores the last desktop workspace on startup and clears it when closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-restore-'))
    try {
      const workspace = join(root, 'workspace')
      await mkdir(workspace)
      await initializeWorkspace(new NodeFileStore(workspace), '自动恢复工作区')
      const settings = new SettingsService(join(root, 'settings.json'))
      const { registerIpc } = await import('../ipc')
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never })

      await handlers.get(IPC.CloseWorkspace)! (null)
      await settings.update({ lastWorkspacePath: workspace })

      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toMatchObject({
        name: '自动恢复工作区',
        path: workspace
      })

      await handlers.get(IPC.CloseWorkspace)! (null)
      expect((await settings.load()).lastWorkspacePath).toBeUndefined()
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps writing statistics available when a recent workspace path has disappeared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-ipc-writing-stale-'))
    try {
      const valid = join(root, 'valid')
      const stale = join(root, 'deleted-parent', 'old-workspace')
      await mkdir(valid)
      const store = new NodeFileStore(valid)
      await initializeWorkspace(store, '仍可访问')
      await store.writeText('.storyfabric/writing-stats/2026-09.json', JSON.stringify([
        { date: '2026-09-26', added: 8, deleted: 2, net: 6, totalWords: 106, updatedAt: 1 }
      ]))
      const settingsFile = join(root, 'settings.json')
      await writeFile(settingsFile, JSON.stringify({ recentWorkspaces: [stale, valid] }), 'utf-8')
      const { registerIpc } = await import('../ipc')
      registerIpc({
        win: () => null,
        settings: new SettingsService(settingsFile),
        agent: {} as never,
        usage: { listBuckets: async () => [] } as never
      })
      await handlers.get(IPC.CloseWorkspace)!(null)

      await expect(handlers.get(IPC.GetWritingDays)!()).resolves.toEqual([
        { workspaceId: valid, date: '2026-09-26', added: 8, deleted: 2, net: 6, totalWords: 106, updatedAt: 1 }
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
