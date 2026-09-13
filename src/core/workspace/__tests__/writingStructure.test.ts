import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { deleteChapter, deleteCharacter, getNote, getSetting, listCharacters, listChapters, listEvents, listNotes, listSettings, loadRelationships, saveChapter, saveCharacter, saveNote, saveRelationships, saveSetting } from '../entityStore'
import { initializeWorkspace, listVolumes, moveChapter, saveVolume } from '../workspaceService'
import { listTrash, restoreFromTrash } from '../trash'
import { stringifyFrontMatter } from '../frontMatter'

describe('writing structure', () => {
  it('supports classified settings, notes and chapter boxes', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const volume = await saveVolume(store, { title: '第二卷', order: 2 })
    const chapter = await saveChapter(store, { title: '草稿章', box: 'draft', content: '草稿内容' })
    await moveChapter(store, chapter.id, { box: 'main', volumeId: volume.id })
    expect((await listChapters(store))[0].volumeId).toBe(volume.id)
    const setting = await saveSetting(store, { title: '星门', category: 'background', tags: ['术语'], content: '星门规则' })
    const note = await saveNote(store, { title: '待办', pinned: true, content: '补充星门' })
    expect((await listSettings(store))[0].id).toBe(setting.id)
    expect((await listNotes(store))[0].id).toBe(note.id)
    expect((await getSetting(store, setting.id))?.content).toContain('星门规则')
    expect((await getNote(store, note.id))?.content).toContain('补充星门')
    expect((await listVolumes(store)).map((item) => item.title)).toEqual(['第一卷', '第二卷'])
  })

  it('writes chapter prose with full-width paragraph indentation', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const chapter = await saveChapter(store, { title: '缩进测试', content: '第一段。\n\n第二段。' })

    expect(chapter.content).toBe('　　第一段。\n\n　　第二段。')
    expect(await store.readText('chapters/main/vol_default/0001-缩进测试.md')).toContain('\n\n　　第一段。\n\n　　第二段。')
  })

  it('moves deleted chapters to trash and restores them', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const chapter = await saveChapter(store, { title: '可恢复', content: '正文' })
    await deleteChapter(store, chapter.id)
    expect(await listChapters(store)).toHaveLength(0)
    expect((await listTrash(store)).map((item) => item.id)).toContain(chapter.id)
    await restoreFromTrash(store, chapter.id)
    expect((await listChapters(store))[0].title).toBe('可恢复')
  })

  it('reads legacy flat chapter metadata with v2 defaults', async () => {
    const store = new MemoryFileStore()
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 1, name: '旧项目' }))
    await store.writeText('chapters/0001-开端.md', stringifyFrontMatter('正文', { id: 'cha_1', title: '开端', order: 1, volume: '第一卷' }))
    await initializeWorkspace(store, '旧项目')
    const chapter = (await listChapters(store))[0]
    expect(chapter.box).toBe('main')
    expect(chapter.volumeId).toBe('vol_default')
  })

  it('migrates legacy events into the first workspace volume', async () => {
    const store = new MemoryFileStore()
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 2, name: '旧事件项目' }))
    await store.writeText('chapters/volumes.json', JSON.stringify([{ id: 'vol_two', title: '第二卷', order: 2 }]))
    await store.writeText('events/旧事件.md', stringifyFrontMatter('事件内容', {
      id: 'evt_legacy',
      title: '旧事件',
      order: 1,
      prevIds: [],
      nextIds: []
    }))

    await initializeWorkspace(store, '旧事件项目')

    const migrated = (await listEvents(store))[0]
    expect(migrated.volumeId).toBe('vol_two')
    expect(migrated.branchIds).toEqual([])
  })

  it('persists a new primary character under the primary tier', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const character = await saveCharacter(store, { name: '主角', tier: 'primary' })

    expect(character.tier).toBe('primary')
    expect(await store.readText('characters/primary/主角.md')).not.toBeNull()
    expect(await store.readText('characters/secondary/主角.md')).toBeNull()
  })

  it('preserves unknown front matter fields when loading and saving an entity', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    await store.writeText('characters/secondary/带扩展字段.md', stringifyFrontMatter('正文', {
      id: 'char_future', name: '带扩展字段', futureField: { enabled: true }, tier: 'secondary'
    }))

    await saveCharacter(store, { id: 'char_future', summary: '已更新' })
    const raw = await store.readText('characters/secondary/带扩展字段.md')
    expect(raw).toContain('futureField:')
    expect((await listCharacters(store)).find((item) => item.id === 'char_future')?.name).toBe('带扩展字段')
  })

  it('restores relationships together with a deleted character', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const from = await saveCharacter(store, { name: '甲' })
    const to = await saveCharacter(store, { name: '乙' })
    await saveRelationships(store, [{ id: 'rel_1', fromId: from.id, toId: to.id, type: '同伴', label: '', description: '', directed: false }])

    await deleteCharacter(store, from.id)
    expect(await loadRelationships(store)).toEqual([])
    await restoreFromTrash(store, from.id)
    expect((await loadRelationships(store)).map((item) => item.id)).toContain('rel_1')
  })
})
