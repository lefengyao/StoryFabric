import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../fileStore'
import { NodeFileStore } from '../nodeFileStore'

describe('FileStore contract', () => {
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
})
