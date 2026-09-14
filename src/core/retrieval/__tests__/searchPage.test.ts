import { describe, expect, it } from 'vitest'
import { MemoryFileStore, type SourceReadResult } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { saveChapter, saveCharacter, saveEvent, saveNote, saveOutlineDoc, saveRelationships, saveSetting } from '../../workspace/entityStore'
import { loadProjectCorpus } from '../projectCorpus'
import { mayClaimNoMatches, searchProjectPage, SearchProjectError } from '../projectIndex'

async function workspace(): Promise<MemoryFileStore> {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '检索测试')
  return store
}

describe('complete project corpus and paginated search', () => {
  it('finds tail content and structured metadata across every default source kind', async () => {
    const store = await workspace()
    const a = await saveCharacter(store, { name: '甲', age: '大二', faction: '特殊组织', content: '开头\n'.repeat(400) + '唐小糖' })
    const b = await saveCharacter(store, { name: '乙' })
    await saveRelationships(store, [{ id: 'rel_tail', fromId: a.id, toId: b.id, type: '同伴', label: '', description: '唐小糖', directed: false }])
    await saveOutlineDoc(store, { title: '总纲', kind: 'total', content: '开头\n'.repeat(400) + '唐小糖' })
    await saveEvent(store, { title: '事件', volumeId: 'vol_default', characterIds: [a.id], content: '唐小糖' })
    await saveChapter(store, { title: '章节', box: 'draft', content: '开头\n'.repeat(400) + '唐小糖' })
    await saveSetting(store, { title: '设定', category: 'background', content: '唐小糖' })
    await saveNote(store, { title: '便签', content: '唐小糖' })

    const corpus = await loadProjectCorpus(store)
    expect(new Set(corpus.entries.map((entry) => entry.kind))).toEqual(new Set(['character', 'relationship', 'outline', 'event', 'chapter', 'setting', 'note']))
    const page = await searchProjectPage(store, { query: '唐小糖', limit: 100 })
    expect(page.totalMatches).toBe(7)
    expect(page.hits.some((hit) => hit.kind === 'relationship' && hit.field === 'description')).toBe(true)

    expect((await searchProjectPage(store, { query: '大二' })).totalMatches).toBe(1)
    expect((await searchProjectPage(store, { query: '特殊组织' })).totalMatches).toBe(1)
    expect((await searchProjectPage(store, { query: '甲' })).hits.some((hit) => hit.kind === 'relationship' && hit.field === 'from.name')).toBe(true)
    expect((await searchProjectPage(store, { query: '甲', kinds: ['relationship'] })).hits.some((hit) => hit.field === 'from.name')).toBe(true)
  })

  it('paginates every hit without duplication and binds cursors to query and revision', async () => {
    const store = await workspace()
    for (let index = 0; index < 46; index += 1) await saveCharacter(store, { name: `人物${index}`, summary: '共同词' })
    const first = await searchProjectPage(store, { query: '共同词', limit: 20 })
    expect(first.totalMatches).toBe(46)
    expect(first.nextCursor).toBeTruthy()

    const second = await searchProjectPage(store, { query: '共同词', limit: 20, cursor: first.nextCursor })
    const third = await searchProjectPage(store, { query: '共同词', limit: 20, cursor: second.nextCursor })
    const ids = [...first.hits, ...second.hits, ...third.hits].map((hit) => `${hit.sourcePath}:${hit.field}:${hit.offset}`)
    expect(ids).toHaveLength(46)
    expect(new Set(ids).size).toBe(46)
    expect(third.nextCursor).toBeUndefined()

    await expect(searchProjectPage(store, { query: '共同词', limit: 20, cursor: `${first.nextCursor}x` })).rejects.toBeInstanceOf(SearchProjectError)
    await saveCharacter(store, { name: '后来者', summary: '共同词' })
    await expect(searchProjectPage(store, { query: '共同词', limit: 20, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'PROJECT_CHANGED' })
  })

  it('does not claim a complete negative result when a source read failed', async () => {
    class FailingStore extends MemoryFileStore {
      override async readTextStrict(path: string): Promise<SourceReadResult> {
        if (path === 'settings/背景/broken.md') return { ok: false, code: 'IO_ERROR' }
        return super.readTextStrict(path)
      }
    }
    const store = new FailingStore()
    await initializeWorkspace(store, '失读测试')
    await store.writeText('settings/背景/broken.md', '---\nid: set_broken\ntitle: 坏文件\ncategory: background\n---\n\n没有关键词')
    await saveCharacter(store, { name: '甲', summary: '没有关键词' })

    const page = await searchProjectPage(store, { query: '不存在', limit: 20 })
    expect(page.totalMatches).toBe(0)
    expect(page.scanComplete).toBe(false)
    expect(page.coverage.failedSources).toContainEqual({ sourcePath: 'settings/背景/broken.md', code: 'IO_ERROR' })
    expect(mayClaimNoMatches(page)).toBe(false)
  })
})
