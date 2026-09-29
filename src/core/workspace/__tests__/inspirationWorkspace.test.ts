import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { MemoryFileStore } from '../../storage/fileStore'
import { exportWorkspaceArchive, importWorkspaceArchive, WORKSPACE_ARCHIVE_MAX_ENTRY_BYTES } from '../archive'
import { migrateWorkspace } from '../migration'
import { initializeWorkspace } from '../workspaceService'

async function zipBytes(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, value] of Object.entries(files)) zip.file(path, value)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('inspiration workspace directories', () => {
  it('creates visible inspiration storage and hidden metadata storage for new and existing workspaces', async () => {
    const fresh = new MemoryFileStore()
    await initializeWorkspace(fresh, '新项目')
    expect(await fresh.exists('inspiration')).toBe(true)
    expect(await fresh.exists('.storyfabric/inspiration')).toBe(true)

    const legacy = new MemoryFileStore()
    const reference = new Uint8Array([37, 80, 68, 70])
    await legacy.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '旧项目' }))
    await legacy.writeBytes('inspiration/imported/src_1/reference.pdf', reference)
    await migrateWorkspace(legacy)
    expect(await legacy.exists('inspiration')).toBe(true)
    expect(await legacy.exists('.storyfabric/inspiration')).toBe(true)
    expect(await legacy.readBytes('inspiration/imported/src_1/reference.pdf')).toEqual(reference)
  })

  it('round-trips nested inspiration bytes and allowed metadata through an archive', async () => {
    const source = new MemoryFileStore()
    const reference = new Uint8Array([37, 80, 68, 70])
    const catalog = new TextEncoder().encode('{"sources":["src_1"]}')
    const cache = new TextEncoder().encode('{"sourceId":"src_1"}')
    await initializeWorkspace(source, '资料')
    await source.writeBytes('inspiration/imported/src_1/reference.pdf', reference)
    await source.writeBytes('.storyfabric/inspiration/catalog.json', catalog)
    await source.writeBytes('.storyfabric/inspiration/cache/src_1.json', cache)

    const archive = await exportWorkspaceArchive(source, '资料')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)

    expect(await target.readBytes('inspiration/imported/src_1/reference.pdf')).toEqual(reference)
    expect(await target.readBytes('.storyfabric/inspiration/catalog.json')).toEqual(catalog)
    expect(await target.readBytes('.storyfabric/inspiration/cache/src_1.json')).toEqual(cache)
  })

  it('round-trips the actual extracted-text cache directory as bytes', async () => {
    const source = new MemoryFileStore()
    const extracted = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x22, 0x74, 0x65, 0x78, 0x74, 0x22, 0x3a, 0x22, 0xe5, 0x8f, 0x82, 0x22, 0x7d])
    await initializeWorkspace(source, '提取缓存')
    await source.writeBytes('.storyfabric/inspiration/extracted/source_1.json', extracted)

    const archive = await exportWorkspaceArchive(source, '提取缓存')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)

    expect(await target.readBytes('.storyfabric/inspiration/extracted/source_1.json')).toEqual(extracted)
  })

  it('preserves BOM bytes in hidden inspiration catalog and cache files', async () => {
    const source = new MemoryFileStore()
    const catalog = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])
    const cache = new Uint8Array([0xef, 0xbb, 0xbf, 0x5b, 0x22, 0xe5, 0x8f, 0x82, 0x22, 0x5d])
    await initializeWorkspace(source, 'BOM资料')
    await source.writeBytes('.storyfabric/inspiration/catalog.json', catalog)
    await source.writeBytes('.storyfabric/inspiration/cache/src_1.json', cache)

    const archive = await exportWorkspaceArchive(source, 'BOM资料')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)

    expect(await target.readBytes('.storyfabric/inspiration/catalog.json')).toEqual(catalog)
    expect(await target.readBytes('.storyfabric/inspiration/cache/src_1.json')).toEqual(cache)
  })

  it('rejects a path escape from inspiration before writing any files', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({
      'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 3, name: '测试' }),
      'inspiration/../../outside.txt': 'nope'
    })

    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('非法路径')
    expect(await target.listFiles('')).toEqual([])
  })

  it('rejects hidden inspiration files outside the catalog and cache whitelist', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({
      'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 3, name: '测试' }),
      '.storyfabric/inspiration/unapproved.json': '{}'
    })

    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('.storyfabric/inspiration/unapproved.json')
    expect(await target.listFiles('')).toEqual([])
  })

  it('rejects illegal inspiration path segments before writing any files', async () => {
    for (const path of ['inspiration/CON.pdf', 'inspiration/imported/a?.pdf', 'inspiration/imported/trailing-space. ']) {
      const target = new MemoryFileStore()
      const bytes = await zipBytes({
        'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 3, name: '测试' }),
        [path]: 'nope'
      })

      await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('非法路径')
      expect(await target.listFiles('')).toEqual([])
    }
  })

  it('round-trips every cache file under the hidden cache directory', async () => {
    const source = new MemoryFileStore()
    const temporaryCache = new Uint8Array([0, 255, 1])
    const backupCache = new Uint8Array([37, 80, 68, 70])
    await initializeWorkspace(source, '缓存')
    await source.writeBytes('.storyfabric/inspiration/cache/extracted/chunk.tmp', temporaryCache)
    await source.writeBytes('.storyfabric/inspiration/cache/extracted/backup.bak', backupCache)

    const archive = await exportWorkspaceArchive(source, '缓存')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)

    expect(await target.readBytes('.storyfabric/inspiration/cache/extracted/chunk.tmp')).toEqual(temporaryCache)
    expect(await target.readBytes('.storyfabric/inspiration/cache/extracted/backup.bak')).toEqual(backupCache)
  })

  it('rejects an oversized inspiration file under the archive entry limit', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({
      'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 3, name: '测试' }),
      'inspiration/imported/too-large.pdf': new Uint8Array(WORKSPACE_ARCHIVE_MAX_ENTRY_BYTES + 1)
    })

    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('过大的文件')
    expect(await target.listFiles('')).toEqual([])
  })
})
