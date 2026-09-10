import { promises as fs } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryFileStore } from '../../../core/storage/fileStore'
import { exportWorkspaceArchive } from '../../../core/workspace/archive'
import { importWorkspaceIntoNewFolder } from '../workspaceService'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeArchive() {
  const source = new MemoryFileStore()
  await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '导入源' }))
  await source.writeText('characters/林晚.md', '# 林晚')
  return exportWorkspaceArchive(source, '导入源')
}

describe('Windows workspace import', () => {
  it('imports into a new sibling directory without changing an existing project', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'storyfabric-import-'))
    roots.push(parent)
    const existing = join(parent, '现有项目')
    await mkdir(existing)
    await writeFile(join(existing, 'keep.txt'), 'keep')

    await expect(importWorkspaceIntoNewFolder(parent, '现有项目', (await makeArchive()).bytes)).rejects.toThrow('文件夹已存在')
    expect(await readFile(join(existing, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('publishes only a fully validated archive and removes temporary data on failure', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'storyfabric-import-'))
    roots.push(parent)
    const root = await importWorkspaceIntoNewFolder(parent, '导入副本', (await makeArchive()).bytes)

    expect(await readFile(join(root, 'characters', '林晚.md'), 'utf8')).toBe('# 林晚')
    await expect(importWorkspaceIntoNewFolder(parent, '损坏导入', new Uint8Array([1]))).rejects.toThrow('无法读取工作区压缩包')
    expect((await (await import('node:fs/promises')).readdir(parent)).filter((name) => name.startsWith('.storyfabric-import-'))).toEqual([])
    await expect(fs.access(join(parent, '损坏导入'))).rejects.toThrow()
  })

  it('reserves the target directory and imports without renaming over it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'storyfabric-import-'))
    roots.push(parent)
    const rename = vi.spyOn(fs, 'rename')

    const root = await importWorkspaceIntoNewFolder(parent, '独占发布', (await makeArchive()).bytes)

    expect(rename.mock.calls.filter(([, destination]) => destination === root)).toHaveLength(0)
    expect(await readFile(join(root, 'characters', '林晚.md'), 'utf8')).toBe('# 林晚')
  })

  it('serializes same-name imports and never overwrites the first published workspace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'storyfabric-import-'))
    roots.push(parent)
    const archive = await makeArchive()

    const results = await Promise.allSettled([
      importWorkspaceIntoNewFolder(parent, '并发导入', archive.bytes),
      importWorkspaceIntoNewFolder(parent, '并发导入', archive.bytes)
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected').map((result) => result.reason.message)).toEqual(['文件夹已存在：并发导入'])
    expect(await readFile(join(parent, '并发导入', 'characters', '林晚.md'), 'utf8')).toBe('# 林晚')
  })

  it('rejects an existing file without replacing it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'storyfabric-import-'))
    roots.push(parent)
    const archive = await makeArchive()
    const existingFile = join(parent, '同名文件')
    await writeFile(existingFile, 'keep')

    await expect(importWorkspaceIntoNewFolder(parent, '同名文件', archive.bytes)).rejects.toThrow('文件夹已存在：同名文件')
    expect(await readFile(existingFile, 'utf8')).toBe('keep')
  })

  it.skipIf(process.platform === 'win32')('rejects an existing link without replacing it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'storyfabric-import-'))
    roots.push(parent)
    const archive = await makeArchive()
    const existingDirectory = join(parent, '目标目录')
    const link = join(parent, '同名链接')
    await mkdir(existingDirectory)
    await symlink(existingDirectory, link)
    await expect(importWorkspaceIntoNewFolder(parent, '同名链接', archive.bytes)).rejects.toThrow('文件夹已存在：同名链接')
  })
})
