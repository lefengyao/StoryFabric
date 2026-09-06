import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../../core/storage/fileStore'
import { exportWorkspaceArchive } from '../../../core/workspace/archive'
import { importWorkspaceIntoNewFolder } from '../workspaceService'

const roots: string[] = []

afterEach(async () => {
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
  })
})
