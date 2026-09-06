import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
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
})
