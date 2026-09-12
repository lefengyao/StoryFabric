import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { exportWorkspaceArchive } from '../../core/workspace/archive'
import { initializeWorkspace } from '../../core/workspace/workspaceService'
import { WorkspaceRegistry } from '../workspaceRegistry'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function dataRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'storyfabric-registry-'))
  roots.push(root)
  return root
}

async function snapshotFiles(root: string): Promise<Array<{ path: string; content: string; mtimeMs: number }>> {
  const result: Array<{ path: string; content: string; mtimeMs: number }> = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) result.push({ path: relative(root, path), content: await readFile(path, 'utf8'), mtimeMs: (await stat(path)).mtimeMs })
    }
  }
  await visit(root)
  return result.sort((left, right) => left.path.localeCompare(right.path))
}

describe('server workspace registry', () => {
  it('migrates one valid legacy workspace to the default managed ID without overwriting data', async () => {
    const root = await dataRoot()
    const legacy = join(root, 'workspace')
    await mkdir(legacy)
    await initializeWorkspace(new NodeFileStore(legacy), '旧项目')
    const registry = await WorkspaceRegistry.open(root, legacy)

    expect((await registry.list()).map((workspace) => workspace.path)).toContain('default')
    await expect(stat(join(root, 'workspaces', 'default', 'storyfabric.json'))).resolves.toBeDefined()
    await expect(stat(legacy)).rejects.toThrow()
  })

  it('creates and imports independent managed workspaces without exposing filesystem paths', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const original = await registry.create('原项目')
    const source = new NodeFileStore(join(root, 'workspaces', original.path))
    const archive = await exportWorkspaceArchive(source, '原项目')
    const imported = await registry.importArchive(archive.bytes, '导入项目')

    expect(imported.path).not.toBe(original.path)
    expect(imported.path).not.toContain(root)
    const persisted = JSON.parse(await readFile(join(root, 'workspaces', 'registry.json'), 'utf8')) as { workspaces: Array<{ id: string }> }
    expect(persisted.workspaces.map((workspace) => workspace.id)).toEqual(expect.arrayContaining([original.path, imported.path]))
  })

  it('rejects path-like IDs outside the managed root', async () => {
    const registry = await WorkspaceRegistry.open(await dataRoot())
    await expect(registry.getStore('../outside')).rejects.toThrow('工作区不存在')
  })

  it('persists an import display name into workspace metadata', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const original = await registry.create('原名称')
    const source = new NodeFileStore(join(root, 'workspaces', original.path))
    const archive = await exportWorkspaceArchive(source, '原名称')
    const imported = await registry.importArchive(archive.bytes, '新名称')
    expect(imported.name).toBe('新名称')
    const metadata = JSON.parse(await readFile(join(root, 'workspaces', imported.path, 'storyfabric.json'), 'utf8')) as { name?: string }
    expect(metadata.name).toBe('新名称')
  })

  it('rolls back only the exact imported workspace returned by the import transaction', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const existing = await registry.create('既有项目')
    const source = new NodeFileStore(join(root, 'workspaces', existing.path))
    const archive = await exportWorkspaceArchive(source, '既有项目')
    const imported = await registry.importArchive(archive.bytes, '待回滚项目')

    await registry.removeImported(imported)

    await expect(registry.summary(imported.path)).rejects.toThrow('工作区不存在')
    await expect(registry.summary(existing.path)).resolves.toMatchObject({ path: existing.path, name: '既有项目' })
    expect((await registry.list()).map((item) => item.path)).toEqual(expect.arrayContaining(['default', existing.path]))
  })

  it('keeps every workspace record when concurrent creates complete', async () => {
    const registry = await WorkspaceRegistry.open(await dataRoot())
    const created = await Promise.all(['并发项目 A', '并发项目 B', '并发项目 C'].map((name) => registry.create(name)))
    const listed = await registry.list()
    expect(listed.map((item) => item.path)).toEqual(expect.arrayContaining(created.map((item) => item.path)))
  })

  it('opens an already registered workspace by its server path with the opaque ID', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const created = await registry.create('已登记项目')

    await expect(registry.openPath(join(root, 'workspaces', created.path))).resolves.toMatchObject({ path: created.path, name: '已登记项目' })
  })

  it('skips damaged registry records while opening a valid workspace path', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const records = (registry as unknown as { records: Array<{ id: string; name: string; createdAt: number; updatedAt: number; directory?: string }> }).records
    records.unshift({ id: 'ws_badrecord01', name: '损坏记录', createdAt: 1, updatedAt: 1, directory: '../outside' })

    await expect(registry.openPath(join(root, 'workspaces', 'default'))).resolves.toMatchObject({ path: 'default' })
  })

  it('registers an existing managed workspace without moving or changing it', async () => {
    const root = await dataRoot()
    const diskPath = join(root, 'workspaces', 'from-disk')
    await mkdir(diskPath, { recursive: true })
    await initializeWorkspace(new NodeFileStore(diskPath), '磁盘项目')
    const before = await readFile(join(diskPath, 'storyfabric.json'), 'utf8')
    const registry = await WorkspaceRegistry.open(root)

    const opened = await registry.openPath(diskPath)

    expect(opened.name).toBe('磁盘项目')
    expect(opened.path).toMatch(/^ws_[a-z0-9]{12}$/)
    expect(opened.path).not.toBe('from-disk')
    await expect(stat(diskPath)).resolves.toBeDefined()
    await expect(readFile(join(diskPath, 'storyfabric.json'), 'utf8')).resolves.toBe(before)
    await expect(registry.openPath(diskPath)).resolves.toMatchObject({ path: opened.path })
  })

  it('does not write, migrate, clean, or index an unregistered workspace while opening it', async () => {
    const root = await dataRoot()
    const diskPath = join(root, 'workspaces', 'from-disk')
    await mkdir(diskPath, { recursive: true })
    await initializeWorkspace(new NodeFileStore(diskPath), '只读项目')
    const before = await snapshotFiles(diskPath)
    const registry = await WorkspaceRegistry.open(root)

    const opened = await registry.openPath(diskPath)

    expect(opened.name).toBe('只读项目')
    await expect(snapshotFiles(diskPath)).resolves.toEqual(before)
    expect((await snapshotFiles(diskPath)).some((file) => file.path.includes('project-index'))).toBe(false)
  })

  it.each([
    ['managed root', (root: string) => join(root, 'workspaces')],
    ['outside managed root', (root: string) => join(root, 'outside')],
    ['parent traversal', (root: string) => join(root, 'workspaces', '..', 'outside')],
    ['ordinary file', (root: string) => join(root, 'workspaces', 'file.txt')],
    ['damaged directory', (root: string) => join(root, 'workspaces', 'damaged')],
  ])('rejects %s when opening by path', async (_label, pathFor) => {
    const root = await dataRoot()
    await mkdir(join(root, 'workspaces', 'damaged'), { recursive: true })
    await writeFile(join(root, 'workspaces', 'file.txt'), 'not a workspace')
    const registry = await WorkspaceRegistry.open(root)

    await expect(registry.openPath(pathFor(root))).rejects.toThrow()
  })

  it('reads old registry records without directory and resolves their ID directory', async () => {
    const root = await dataRoot()
    const managed = join(root, 'workspaces')
    const legacyId = 'ws_legacy000001'
    await mkdir(join(managed, legacyId), { recursive: true })
    await initializeWorkspace(new NodeFileStore(join(managed, legacyId)), '旧注册记录')
    await writeFile(join(managed, 'registry.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: legacyId, name: '旧注册记录', createdAt: 1, updatedAt: 1 }],
    }))
    const registry = await WorkspaceRegistry.open(root)

    await expect(registry.summary(legacyId)).resolves.toMatchObject({ path: legacyId, name: '旧注册记录' })
  })

  it.each(['.', './'])('rejects a registry record that points at the managed root (%s)', async (directory) => {
    const root = await dataRoot()
    const managed = join(root, 'workspaces')
    await mkdir(managed, { recursive: true })
    await writeFile(join(managed, 'registry.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'ws_aaaaaaaaaaaa', name: '托管根目录', createdAt: 1, updatedAt: 1, directory }],
    }))

    await expect(WorkspaceRegistry.open(root)).rejects.toThrow('托管根目录')
  })

  it('rejects registry records whose directories resolve to the same real path', async () => {
    const root = await dataRoot()
    const managed = join(root, 'workspaces')
    const target = join(managed, 'target')
    await mkdir(target, { recursive: true })
    await initializeWorkspace(new NodeFileStore(target), '重复目录')
    await symlink(target, join(managed, 'alias-a'), 'junction')
    await symlink(target, join(managed, 'alias-b'), 'junction')
    await writeFile(join(managed, 'registry.json'), JSON.stringify({
      version: 1,
      workspaces: [
        { id: 'ws_alias0000001', name: 'A', createdAt: 1, updatedAt: 1, directory: 'alias-a' },
        { id: 'ws_alias0000002', name: 'B', createdAt: 1, updatedAt: 1, directory: 'alias-b' },
      ],
    }))

    await expect(WorkspaceRegistry.open(root)).rejects.toThrow('重复目录')
  })

  it('rejects a registry directory symlink escape during startup', async () => {
    const root = await dataRoot()
    const managed = join(root, 'workspaces')
    const outside = join(root, 'outside-registered')
    await mkdir(outside, { recursive: true })
    await initializeWorkspace(new NodeFileStore(outside), '恶意外部项目')
    await mkdir(managed, { recursive: true })
    await symlink(outside, join(managed, 'escaped'), 'junction')
    await writeFile(join(managed, 'registry.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'ws_escape000001', name: '恶意记录', createdAt: 1, updatedAt: 1, directory: 'escaped' }],
    }))

    await expect(WorkspaceRegistry.open(root)).rejects.toThrow('工作区目录越界')
  })

  it('rejects a dangling registry symlink whose target is outside the managed root', async () => {
    const root = await dataRoot()
    const managed = join(root, 'workspaces')
    const missingOutside = join(root, 'missing-external-workspace')
    await mkdir(managed, { recursive: true })
    await symlink(missingOutside, join(managed, 'dangling-escaped'), 'junction')
    await writeFile(join(managed, 'registry.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'ws_dangling0001', name: '悬空恶意记录', createdAt: 1, updatedAt: 1, directory: 'dangling-escaped' }],
    }))

    await expect(WorkspaceRegistry.open(root)).rejects.toThrow('工作区目录越界')
  })

  it('revalidates registered paths after the directory is replaced by an external junction', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const outside = join(root, 'outside-replaced')
    const registered = join(root, 'workspaces', 'default')
    await mkdir(outside, { recursive: true })
    await initializeWorkspace(new NodeFileStore(outside), '外部替换项目')
    await rm(registered, { recursive: true, force: true })
    await symlink(outside, registered, 'junction')

    await expect(registry.summary('default')).rejects.toThrow('工作区目录越界')
    const store = await registry.getStore('default')
    await expect(store.readText('storyfabric.json')).rejects.toThrow('工作区目录越界')
    expect((await registry.list()).some((workspace) => workspace.name === '外部替换项目')).toBe(false)
  })

  it('revalidates every facade operation after its workspace is replaced externally', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const store = await registry.getStore('default')
    const outside = join(root, 'outside-facade')
    const registered = join(root, 'workspaces', 'default')
    await mkdir(outside, { recursive: true })
    await initializeWorkspace(new NodeFileStore(outside), '外部 facade 项目')
    await rm(registered, { recursive: true, force: true })
    await symlink(outside, registered, 'junction')

    await expect(store.readText('storyfabric.json')).rejects.toThrow('工作区目录越界')
    await expect(store.listFiles('')).rejects.toThrow('工作区目录越界')
    await expect(store.ensureDir('new-dir')).rejects.toThrow('工作区目录越界')
  })

  it('rejects all registered access after the managed root is replaced externally', async () => {
    const root = await dataRoot()
    const registry = await WorkspaceRegistry.open(root)
    const outside = join(root, 'outside-managed-root')
    const managed = join(root, 'workspaces')
    await mkdir(outside, { recursive: true })
    await mkdir(join(outside, 'default'), { recursive: true })
    await initializeWorkspace(new NodeFileStore(join(outside, 'default')), '外部根项目')
    await rm(managed, { recursive: true, force: true })
    await symlink(outside, managed, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(registry.summary('default')).rejects.toThrow('工作区目录越界')
    const store = await registry.getStore('default')
    await expect(store.listFiles('')).rejects.toThrow('工作区目录越界')
    expect((await registry.list()).some((workspace) => workspace.name === '外部根项目')).toBe(false)
  })

  it('stores an unregistered directory relative to the real managed root', async () => {
    const actualRoot = await dataRoot()
    const linkContainer = await mkdtemp(join(tmpdir(), 'storyfabric-registry-link-'))
    roots.push(linkContainer)
    const linkedRoot = join(linkContainer, 'data-link')
    await symlink(actualRoot, linkedRoot, 'junction')
    const diskPath = join(actualRoot, 'workspaces', 'from-disk')
    await mkdir(diskPath, { recursive: true })
    await initializeWorkspace(new NodeFileStore(diskPath), '真实根项目')
    const registry = await WorkspaceRegistry.open(linkedRoot)

    const opened = await registry.openPath(diskPath)
    const persisted = JSON.parse(await readFile(join(actualRoot, 'workspaces', 'registry.json'), 'utf8')) as { workspaces: Array<{ id: string; directory?: string }> }
    const record = persisted.workspaces.find((workspace) => workspace.id === opened.path)

    expect(record?.directory).toBe('from-disk')
    expect(record?.directory).not.toContain('..')
  })

  it('rejects a symlink that resolves outside the managed root', async () => {
    const root = await dataRoot()
    const outside = join(root, 'outside-workspace')
    await mkdir(outside, { recursive: true })
    await initializeWorkspace(new NodeFileStore(outside), '外部项目')
    const link = join(root, 'workspaces', 'escaped')
    await mkdir(join(root, 'workspaces'), { recursive: true })
    await symlink(outside, link, 'junction')
    const registry = await WorkspaceRegistry.open(root)

    await expect(registry.openPath(link)).rejects.toThrow('服务器工作区目录内')
  })
})
