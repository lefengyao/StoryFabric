import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryFileStore, normalizeRelativePath } from '../fileStore'
import { NodeFileStore } from '../nodeFileStore'

describe('FileStore contract', () => {
  it('rejects empty and root paths for file operations while preserving explicit root listing', async () => {
    expect(() => normalizeRelativePath('')).toThrow('路径不能为空')
    expect(() => normalizeRelativePath('.')).toThrow('路径不能为空')

    const store = new MemoryFileStore()
    await expect(store.remove('')).rejects.toThrow()
    expect(await store.listFiles('')).toEqual([])
    expect(await store.listDirs('')).toEqual([])
  })

  it('supports portable file operations', async () => {
    const store = new MemoryFileStore()
    await store.ensureDir('characters')
    await store.writeText('characters/林晚.md', 'content')

    expect(await store.exists('characters')).toBe(true)
    expect(await store.readText('characters/林晚.md')).toBe('content')
    expect(await store.listFiles('characters', '.md')).toEqual(['林晚.md'])

    await store.remove('characters/林晚.md')
    expect(await store.readText('characters/林晚.md')).toBeNull()
  })

  it('normalizes slash styles and creates parent directories', async () => {
    const store = new MemoryFileStore()
    await store.writeText('outline\\0001-故事.md', '# 故事')
    expect(await store.listFiles('outline', '.MD')).toEqual(['0001-故事.md'])
  })

  it('keeps concurrent atomic writes independent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-filestore-'))
    try {
      const store = new NodeFileStore(root)
      await expect(Promise.all(
        Array.from({ length: 8 }, (_, index) => store.writeText('storyfabric.json', JSON.stringify({ index })))
      )).resolves.toHaveLength(8)

      const value = JSON.parse(await readFile(join(root, 'storyfabric.json'), 'utf8')) as { index: number }
      expect(value.index).toBeGreaterThanOrEqual(0)
      expect(value.index).toBeLessThan(8)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to remove the workspace root in the Node adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-filestore-root-'))
    try {
      const store = new NodeFileStore(root)
      await store.writeText('storyfabric.json', '{"app":"storyfabric"}')
      await expect(store.remove('')).rejects.toThrow()
      expect(await readFile(join(root, 'storyfabric.json'), 'utf8')).toContain('storyfabric')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects every NodeFileStore operation through a nested external symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-filestore-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'storyfabric-filestore-outside-'))
    try {
      const store = new NodeFileStore(root)
      await new NodeFileStore(outside).writeText('secret.txt', 'outside')
      await symlink(outside, join(root, 'nested-link'), process.platform === 'win32' ? 'junction' : 'dir')
      await store.writeText('inside.txt', 'inside')

      await expect(store.exists('nested-link/secret.txt')).rejects.toThrow('工作区外')
      await expect(store.ensureDir('nested-link/new-dir')).rejects.toThrow('工作区外')
      await expect(store.readText('nested-link/secret.txt')).rejects.toThrow('工作区外')
      await expect(store.writeText('nested-link/new.txt', 'blocked')).rejects.toThrow('工作区外')
      await expect(store.move('inside.txt', 'nested-link/moved.txt')).rejects.toThrow('工作区外')
      await expect(store.remove('nested-link/secret.txt')).rejects.toThrow('工作区外')
      await expect(store.modifiedAt('nested-link/secret.txt')).rejects.toThrow('工作区外')
      await expect(store.listFiles('nested-link')).rejects.toThrow('工作区外')
      await expect(store.listDirs('nested-link')).rejects.toThrow('工作区外')
      await expect(readFile(join(outside, 'secret.txt'), 'utf8')).resolves.toBe('outside')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
