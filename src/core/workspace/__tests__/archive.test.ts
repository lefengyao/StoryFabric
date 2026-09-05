import { describe, expect, it } from 'vitest'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../archive'
import { MemoryFileStore } from '../../storage/fileStore'

describe('workspace archive', () => {
  it('exports and imports a portable workspace zip', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', '{"app":"storyfabric"}')
    await source.writeText('characters/林晚.md', '# 林晚')
    const archive = await exportWorkspaceArchive(source, '测试项目')
    expect(archive.fileName).toBe('测试项目.storyfabric.zip')

    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.base64)
    expect(await target.readText('storyfabric.json')).toContain('storyfabric')
    expect(await target.readText('characters/林晚.md')).toBe('# 林晚')
  })
})
