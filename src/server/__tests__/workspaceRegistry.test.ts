import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
