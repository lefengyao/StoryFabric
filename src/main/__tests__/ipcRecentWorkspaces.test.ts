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
        usage: {} as never,
        deploy: {} as never
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
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never, deploy: {} as never })

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
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never, deploy: {} as never })

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
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never, deploy: {} as never })

      const imported = await handlers.get(IPC.ImportWorkspace)!(null, archive.bytes, '导入源.storyfabric.zip', { parentDir: parent, name: '保留导入' })

      expect(imported).toMatchObject({ name: '保留导入', path: join(parent, '保留导入') })
      expect(record).toHaveBeenCalledOnce()
      await expect(access(join(parent, '保留导入', 'storyfabric.json'))).resolves.toBeUndefined()
      await expect(handlers.get(IPC.GetCurrentWorkspace)!()).resolves.toMatchObject({ path: join(parent, '保留导入') })
    } finally {
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
      registerIpc({ win: () => null, settings, agent: {} as never, usage: {} as never, deploy: {} as never })

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
})
