import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../archive'
import { loadSummary, validateWorkspace } from '../workspaceService'
import { getChapterContext } from '../../retrieval/contextBuilder'
import { lookupTerm } from '../../retrieval/projectIndex'

const fixtureRoot = join(process.cwd(), 'examples', 'minimal-workspace')
// The example directory is also used for local reproductions. Keep those
// user-owned documents out of this fixed-fixture test without deleting them.
const localReproductionIds = new Set(['cha_oldname', 'out_oldname'])

async function loadFixture(): Promise<MemoryFileStore> {
  const store = new MemoryFileStore()

  async function copyTree(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        await copyTree(absolute)
        continue
      }
      const path = relative(fixtureRoot, absolute).replaceAll('\\', '/')
      const text = await fs.readFile(absolute, 'utf8')
      const id = text.match(/^id:\s*([^\s]+)\s*$/m)?.[1]
      if (!id || !localReproductionIds.has(id)) await store.writeText(path, text)
    }
  }

  await copyTree(fixtureRoot)
  return store
}

describe('minimal workspace example', () => {
  it('loads every writing category and preserves bounded retrieval behavior', async () => {
    const store = await loadFixture()

    expect((await validateWorkspace(store)).ok).toBe(true)

    const summary = await loadSummary(store, '示例', 'fixture://minimal-workspace')
    expect(summary.name).toBe('星港回声·最小示例')
    expect(summary.version).toBe(3)
    expect(summary.volumes).toEqual([{ id: 'vol_default', title: '第一卷：潮汐', order: 1 }])
    expect(summary.characters.map((item) => item.tier).sort()).toEqual(['primary', 'secondary'])
    expect(summary.outline.map((item) => item.kind).sort()).toEqual(['chapter', 'total'])
    expect(summary.settings?.map((item) => item.category).sort()).toEqual(['background', 'other'])
    expect(summary.notes).toHaveLength(1)
    expect(summary.chapters.map((item) => item.box).sort()).toEqual(['draft', 'main'])
    expect(summary.trashCount).toBe(0)

    const chapter = summary.chapters.find((item) => item.id === 'cha_dawn')
    expect((chapter?.terms ?? []).map((term) => term.term)).toContain('星门')

    const context = await getChapterContext(store, 'cha_dawn', { radius: 1, maxChars: 2000 })
    expect(context.target.content).toContain('潮汐塔')
    expect(context.next.map((item) => item.id)).toContain('cha_draft')
    expect(context.sourceIds).toContain('cha_draft')

    const hits = await lookupTerm(store, '星门')
    expect(hits.map((hit) => `${hit.kind}:${hit.id}`)).toEqual(expect.arrayContaining([
      'setting:set_gate',
      'outline:out_total',
      'chapter:cha_dawn'
    ]))
  })

  it('round-trips the example through the shared workspace archive format', async () => {
    const source = await loadFixture()
    const archive = await exportWorkspaceArchive(source, '星港回声·最小示例')
    const target = new MemoryFileStore()

    await importWorkspaceArchive(target, archive.bytes)
    const summary = await loadSummary(target, '导入副本', 'fixture://imported-minimal-workspace')

    expect(summary.name).toBe('星港回声·最小示例')
    expect(summary.chapters.map((item) => item.id).sort()).toEqual(['cha_dawn', 'cha_draft'])
    expect(summary.settings?.map((item) => item.id).sort()).toEqual(['set_gate', 'set_weather'])
    expect(summary.notes?.[0].id).toBe('note_next')
  })

  it('refuses to silently downgrade a workspace from a newer version', async () => {
    const store = new MemoryFileStore()
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 999, name: '未来项目', futureField: true }))

    await expect(loadSummary(store, '未来项目', 'fixture://future')).rejects.toThrow('版本')
    expect(await store.readText('storyfabric.json')).toContain('"version":999')
  })
})
