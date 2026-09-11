import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../archive'
import { MemoryFileStore } from '../../storage/fileStore'
import { purgeTrashEntry } from '../trash'

async function zipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, value] of Object.entries(files)) zip.file(path, value)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('workspace archive', () => {
  it('exports and imports a portable workspace zip', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '测试项目' }))
    await source.writeText('characters/林晚.md', '# 林晚')
    const archive = await exportWorkspaceArchive(source, '测试项目')
    expect(archive.fileName).toBe('测试项目.storyfabric.zip')

    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)
    expect(await target.readText('storyfabric.json')).toContain('storyfabric')
    expect(await target.readText('characters/林晚.md')).toBe('# 林晚')
  })

  it('keeps only the portable layout runtime file and excludes other runtime data', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '测试项目' }))
    await source.writeText('.storyfabric/layout.json', JSON.stringify({ char_1: { x: 1, y: 2 } }))
    await source.writeText('.storyfabric/sessions/sess_1.json', JSON.stringify({ id: 'sess_1', title: '测试会话' }))
    await source.writeText('.storyfabric/trash/index.json', JSON.stringify([{ id: 'char_1' }]))
    await source.writeText('.storyfabric/index.json', JSON.stringify({ derived: true }))

    const archive = await exportWorkspaceArchive(source, '测试项目')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)

    expect(await target.readText('.storyfabric/layout.json')).not.toBeNull()
    expect(await target.readText('.storyfabric/sessions/sess_1.json')).toBeNull()
    expect(await target.readText('.storyfabric/trash/index.json')).toBeNull()
    expect(await target.readText('.storyfabric/index.json')).toBeNull()
  })

  it('rejects imported trash and arbitrary runtime files before writing', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({
      'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 2, name: '测试' }),
      '.storyfabric/trash/index.json': '[]'
    })

    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('.storyfabric/trash/index.json')
    expect(await target.listFiles('')).toEqual([])
  })

  it('ignores a malformed trash entry whose empty path could otherwise target the workspace root', async () => {
    const target = new MemoryFileStore()
    await target.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '安全项目' }))
    await target.writeText('.storyfabric/trash/index.json', JSON.stringify([{
      id: 'bad', kind: 'note', originalPath: 'notes/bad.md', trashPath: '', deletedAt: 1, title: '恶意条目'
    }]))

    await purgeTrashEntry(target, 'bad')
    expect(await target.readText('storyfabric.json')).toContain('安全项目')
  })

  it('refuses to import into an existing workspace without changing it', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '导入源' }))
    const archive = await exportWorkspaceArchive(source, '导入源')
    const target = new MemoryFileStore()
    await target.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '原项目' }))

    await expect(importWorkspaceArchive(target, archive.bytes)).rejects.toThrow('目标工作区必须为空')
    expect(await target.readText('storyfabric.json')).toContain('原项目')
  })

  it('rejects unsafe and unsupported ZIP entries before writing', async () => {
    const validMetadata = JSON.stringify({ app: 'storyfabric', version: 2, name: '测试' })
    const cases: Array<Record<string, string>> = [
      { '../escape.md': 'nope', 'storyfabric.json': validMetadata },
      { '/escape.md': 'nope', 'storyfabric.json': validMetadata },
      { 'secret.txt': 'nope', 'storyfabric.json': validMetadata },
      { 'storyfabric.json': '{"app":"other","version":2}' }
    ]

    for (const files of cases) {
      const target = new MemoryFileStore()
      await expect(importWorkspaceArchive(target, await zipBytes(files))).rejects.toThrow()
      expect(await target.listFiles('')).toEqual([])
    }
  })

  it('rejects paths that collide on case-insensitive filesystems', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({
      'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 2, name: '测试' }),
      'characters/A.md': '# A',
      'characters/a.md': '# a'
    })
    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('冲突路径')
    expect(await target.listFiles('')).toEqual([])
  })

  it('rejects archives created by a newer workspace version', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({ 'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 999, name: '未来项目' }) })
    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('有效')
  })
})
