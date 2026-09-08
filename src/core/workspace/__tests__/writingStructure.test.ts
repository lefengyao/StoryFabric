import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { deleteChapter, getNote, getSetting, listChapters, listNotes, listSettings, saveChapter, saveNote, saveSetting } from '../entityStore'
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
})
