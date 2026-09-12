import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../archive'
import { initializeWorkspace, loadWorkspaceListItem } from '../workspaceService'
import { migrateWorkspace } from '../migration'

describe('workspace docs directory', () => {
  it('creates docs for new and legacy workspaces while preserving content', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '新项目')
    expect(await store.exists('docs')).toBe(true)
    await store.writeText('docs/plan.md', '规划内容')
    expect(await store.readText('docs/plan.md')).toBe('规划内容')

    const legacy = new MemoryFileStore()
    await legacy.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '旧项目' }))
    await migrateWorkspace(legacy)
    expect(await legacy.exists('docs')).toBe(true)
  })

  it('round-trips docs text and raw bytes through a workspace archive', async () => {
    const source = new MemoryFileStore()
    await initializeWorkspace(source, '资料')
    await source.writeText('docs/plan.md', '规划内容')
    await source.writeBytes('docs/reference.bin', new Uint8Array([0, 255, 128, 1]))
    const archive = await exportWorkspaceArchive(source, '资料')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)
    expect(await target.readText('docs/plan.md')).toBe('规划内容')
    expect(await target.readBytes('docs/reference.bin')).toEqual(new Uint8Array([0, 255, 128, 1]))
  })

  it('does not create docs when loading picker metadata only', async () => {
    const store = new MemoryFileStore()
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '只读' }))
    await loadWorkspaceListItem(store, '只读', 'memory')
    expect(await store.exists('docs')).toBe(false)
  })

  it('rejects a file occupying a directory path in memory just like Node does', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs', '占位文件')
    await expect(store.ensureDir('docs/child')).rejects.toThrow('文件占用')
  })

  it('does not write directories before rejecting a future workspace version', async () => {
    const store = new MemoryFileStore()
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 999, name: '未来' }))
    await expect(migrateWorkspace(store)).rejects.toThrow(/高于当前支持版本/)
    expect(await store.listDirs('')).toEqual([])
  })
})
