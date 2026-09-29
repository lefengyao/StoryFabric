import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { deleteChapter, deleteCharacter, deleteSetting, getNote, getSetting, listCharacters, listChapters, listEvents, listNotes, listSettings, loadRelationships, saveChapter, saveCharacter, saveNote, saveRelationships, saveSetting } from '../entityStore'
import { initializeWorkspace, listVolumes, moveChapter, saveVolume } from '../workspaceService'
import { listTrash, purgeTrashEntry, restoreFromTrash } from '../trash'
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

  it('persists a setting parent and clears it from front matter', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const root = await saveSetting(store, { title: '世界观', content: '' })
    const child = await saveSetting(store, { title: '地理', parentId: root.id, content: '' })

    expect((await getSetting(store, child.id))?.parentId).toBe(root.id)
    expect((await listSettings(store)).find((item) => item.id === child.id)?.parentId).toBe(root.id)
    expect(await store.readText('settings/background/地理.md')).toContain(`parentId: ${root.id}`)

    await saveSetting(store, { id: child.id, parentId: '' })
    expect((await getSetting(store, child.id))?.parentId).toBeUndefined()
    expect(await getSetting(store, child.id)).not.toHaveProperty('parentId')
    expect(await store.readText('settings/background/地理.md')).not.toContain('parentId:')
  })

  it('rejects setting parent cycles without changing the saved document', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const root = await saveSetting(store, { title: '世界观' })
    const child = await saveSetting(store, { title: '地理', parentId: root.id })
    const nested = await saveSetting(store, { title: '港口', parentId: child.id })

    await expect(saveSetting(store, { id: root.id, parentId: nested.id })).rejects.toThrow('循环')
    await expect(saveSetting(store, { id: root.id, parentId: root.id })).rejects.toThrow('循环')
    expect((await getSetting(store, root.id))?.parentId).toBeUndefined()
  })

  it('rejects a missing setting parent but still loads historical orphans', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    await expect(saveSetting(store, { title: '孤立设定', parentId: 'set_missing' })).rejects.toThrow('父级')
    expect(await listSettings(store)).toEqual([])

    const root = await saveSetting(store, { title: '世界观' })
    const child = await saveSetting(store, { title: '地理', parentId: root.id })
    await deleteSetting(store, root.id)
    expect((await getSetting(store, child.id))?.parentId).toBe(root.id)
  })

  it('edits a historical orphan while rejecting a different missing parent', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const root = await saveSetting(store, { title: '世界观' })
    const child = await saveSetting(store, { title: '地理', parentId: root.id, content: '原文' })
    await deleteSetting(store, root.id)

    const edited = await saveSetting(store, { id: child.id, title: '新地理', content: '新正文' })
    expect(edited.parentId).toBe(root.id)
    expect((await getSetting(store, child.id))?.content).toBe('新正文')
    expect((await getSetting(store, child.id))?.parentId).toBe(root.id)
    await expect(saveSetting(store, { id: child.id, parentId: 'set_another_missing' })).rejects.toThrow('父级')
    expect((await getSetting(store, child.id))?.parentId).toBe(root.id)
  })

  it('treats invalid legacy setting parents as root nodes', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    await store.writeText('settings/background/旧设定.md', stringifyFrontMatter('正文', {
      id: 'set_legacy', title: '旧设定', category: 'background', tags: [], parentId: 42
    }))

    expect((await getSetting(store, 'set_legacy'))?.parentId).toBeUndefined()
    expect(await getSetting(store, 'set_legacy')).not.toHaveProperty('parentId')
    expect((await listSettings(store))[0].parentId).toBeUndefined()
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

  it('permanently removes a deleted chapter from the trash index and file store', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const chapter = await saveChapter(store, { title: '永久删除', box: 'draft', content: '正文' })
    await deleteChapter(store, chapter.id)

    await purgeTrashEntry(store, chapter.id)

    expect(await listTrash(store)).toEqual([])
    expect(await store.readText(`.storyfabric/trash/chapter/${chapter.id}.md`)).toBeNull()
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
