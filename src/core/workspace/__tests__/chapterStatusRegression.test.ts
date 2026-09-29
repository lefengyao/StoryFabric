import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { listChapters, loadChapterDocuments, saveChapter, saveChapterInPlace } from '../entityStore'
import { initializeWorkspace, listVolumes } from '../workspaceService'
import { executeTool } from '../../tools/registry'
import { migrateWorkspace } from '../migration'

describe('chapter status and word count regression', () => {
  it('defaults legacy main chapters to body and preserves a final status while refreshing word count', async () => {
    const store = new MemoryFileStore()
    await store.writeText('chapters/main/vol_default/001-legacy.md', '---\nid: cha_legacy\ntitle: Legacy\nbox: main\nvolumeId: vol_default\n---\n\n第一段正文')
    const [legacy] = await listChapters(store)
    expect(legacy.status).toBe('body')
    expect(legacy.wordCount).toBeGreaterThan(0)

    const saved = await saveChapter(store, { id: legacy.id, content: '第一段正文\n第二段正文', status: 'final' })
    expect(saved.status).toBe('final')
    expect(saved.wordCount).toBeGreaterThan(legacy.wordCount)

    const updatedStored = (await loadChapterDocuments(store)).find((item) => item.doc.id === saved.id)
    expect(updatedStored?.fileName).toBeTruthy()
    const inPlace = await saveChapterInPlace(store, updatedStored!.fileName, { content: '更新后的正文' })
    expect(inPlace.status).toBe('final')
    expect(inPlace.wordCount).toBeGreaterThan(0)
  })

  it('normalizes Chinese status labels', async () => {
    const store = new MemoryFileStore()
    await store.writeText('chapters/main/vol_default/001-final.md', '---\nid: cha_final\ntitle: Final\nstatus: 定稿\nbox: main\nvolumeId: vol_default\n---\n\n正文')
    const [chapter] = await listChapters(store)
    expect(chapter.status).toBe('final')
  })

  it('defaults agent-authored main-box chapters to body', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, 'agent-main-status')
    const volume = (await listVolumes(store))[0]
    const outcome = await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '正文箱章节', box: 'main', volumeId: volume.id, content: '正文内容' } }))
    expect(outcome.kind).toBe('pending')
    if (outcome.kind !== 'pending') return
    await outcome.apply()
    expect((await listChapters(store)).find((chapter) => chapter.title === '正文箱章节')?.status).toBe('body')
  })

  it('moves a chapter when its status changes and keeps box and status aligned', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '章节箱位')
    const chapter = await saveChapter(store, { title: '第一章', box: 'main', status: 'body', content: '正文' })
    const revised = await saveChapter(store, { id: chapter.id, status: 'revised' })
    expect(revised.box).toBe('draft')
    expect((await loadChapterDocuments(store)).find((item) => item.doc.id === chapter.id)?.fileName).toContain('draft/')
    const restored = await saveChapter(store, { id: chapter.id, status: 'final' })
    expect(restored.box).toBe('main')
    expect((await loadChapterDocuments(store)).find((item) => item.doc.id === chapter.id)?.fileName).toContain('main/')
  })

  it('repairs old mixed chapter boxes without changing their status or body', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '旧项目')
    await store.writeText('chapters/main/vol_default/001-draft.md', '---\nid: cha_draft\ntitle: Draft\nstatus: draft\nvolumeId: vol_default\n---\n\n草稿正文')
    await store.writeText('chapters/main/vol_default/002-revised.md', '---\nid: cha_revised\ntitle: Revised\nstatus: revised\nvolumeId: vol_default\n---\n\n修订正文')
    await store.writeText('chapters/draft/003-final.md', '---\nid: cha_final\ntitle: Final\nstatus: final\nvolumeId: vol_default\n---\n\n定稿正文')
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 3, name: '旧项目' }))

    await migrateWorkspace(store)
    const chapters = await loadChapterDocuments(store)
    expect(chapters.map(({ doc }) => [doc.id, doc.status, doc.box])).toEqual([
      ['cha_draft', 'draft', 'draft'], ['cha_revised', 'revised', 'draft'], ['cha_final', 'final', 'main']
    ])
    expect(chapters.map(({ doc }) => doc.content)).toEqual(['　　草稿正文', '　　修订正文', '　　定稿正文'])
    expect((await store.readText('storyfabric.json'))).toContain('"version": 4')
    await migrateWorkspace(store)
    expect((await loadChapterDocuments(store)).map(({ doc }) => doc.id)).toEqual(['cha_draft', 'cha_revised', 'cha_final'])
  })

  it('keeps both chapters when migration meets a destination filename collision', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '同名迁移')
    await store.writeText('chapters/draft/001-same.md', '---\nid: cha_original\ntitle: Same\nstatus: draft\nvolumeId: vol_default\n---\n\n已有草稿')
    await store.writeText('chapters/main/vol_default/001-same.md', '---\nid: cha_moved\ntitle: Same\nstatus: revised\nvolumeId: vol_default\n---\n\n需要迁移')
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 3, name: '同名迁移' }))

    await migrateWorkspace(store)
    const chapters = await loadChapterDocuments(store)
    expect(chapters).toHaveLength(2)
    expect(chapters.map(({ doc }) => [doc.id, doc.box, doc.status])).toEqual([
      ['cha_original', 'draft', 'draft'], ['cha_moved', 'draft', 'revised']
    ])
    expect(chapters.map(({ fileName }) => fileName)).toEqual(['draft/001-same.md', 'draft/001-same_cha_moved.md'])
    expect(await store.exists('chapters/main/vol_default/001-same.md')).toBe(false)
  })

  it('uses an existing volume when an old draft lacks a valid volume id', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '旧卷号')
    await store.writeText('chapters/volumes.json', JSON.stringify([{ id: 'vol_second', title: '第二卷', order: 1 }]))
    await store.writeText('chapters/draft/001-final.md', '---\nid: cha_final\ntitle: Final\nstatus: final\nvolumeId: missing\n---\n\n定稿正文')
    await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 3, name: '旧卷号' }))

    await migrateWorkspace(store)
    const [chapter] = await loadChapterDocuments(store)
    expect(chapter.doc.volumeId).toBe('vol_second')
    expect(chapter.fileName).toBe('main/vol_second/001-final.md')
  })
})
