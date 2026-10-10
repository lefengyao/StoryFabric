import { expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { saveChapter, saveChapterInPlace, loadChapterDocuments, deleteChapter } from '../../workspace/entityStore'
import { restoreFromTrash } from '../../workspace/trash'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listWritingDays, recordChapterWriting } from '../writingStats'

it('durably records additions, deletions, net change, and saved project total across chapter saves', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '统计测试')
  const chapter = await saveChapter(store, { title: '第一章', box: 'draft', content: '你好' })
  await saveChapter(store, { id: chapter.id, content: '你好世界' })
  const stored = (await loadChapterDocuments(store)).find(({ doc }) => doc.id === chapter.id)!
  await saveChapterInPlace(store, stored.fileName, { content: '你世界' })
  await saveChapter(store, { id: chapter.id, title: '改名' })

  const days = await listWritingDays(store)
  expect(days).toHaveLength(1)
  expect(days[0]).toMatchObject({ added: 4, deleted: 1, net: 3, totalWords: 3 })
  expect(await listWritingDays(store)).toEqual(days)
})

it('counts chapter trash and restore in deleted and added words', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '统计测试')
  const chapter = await saveChapter(store, { title: '第一章', content: '你好世界' })
  await deleteChapter(store, chapter.id)
  expect((await listWritingDays(store))[0]).toMatchObject({ added: 4, deleted: 4, net: 0, totalWords: 0 })
  await restoreFromTrash(store, chapter.id)
  expect((await listWritingDays(store))[0]).toMatchObject({ added: 8, deleted: 4, net: 4, totalWords: 4 })
})

it('starts a baseline when the first saved chapter is empty', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '统计测试')
  await saveChapter(store, { title: '空白章节', content: '' })
  expect((await listWritingDays(store))[0]).toMatchObject({ added: 0, deleted: 0, net: 0, totalWords: 0 })
})

it('reads only the newest populated statistics month when recording a chapter change', async () => {
  class CountingStore extends MemoryFileStore {
    reads: string[] = []
    override async readText(path: string): Promise<string | null> {
      this.reads.push(path)
      return super.readText(path)
    }
  }
  const store = new CountingStore()
  const root = '.storyfabric/writing-stats'
  const day = (date: string, totalWords: number) => JSON.stringify([{ date, added: 0, deleted: 0, net: 0, totalWords, updatedAt: 100 }])
  for (let month = 1; month <= 12; month++) await store.writeText(`${root}/2025-${String(month).padStart(2, '0')}.json`, day(`2025-${String(month).padStart(2, '0')}-01`, month * 10))
  await store.writeText(`${root}/current.json`, JSON.stringify({ totalWords: 120, updatedAt: 100 }))
  await recordChapterWriting(store, '甲', '甲乙', undefined, new Date(2026, 0, 2).getTime())
  const historicalReads = store.reads.filter((path) => path.includes('/2025-'))
  expect(historicalReads).toEqual([`${root}/2025-12.json`])
  expect(JSON.parse((await store.readText(`${root}/current.json`))!)).toMatchObject({ totalWords: 121 })
})

it('recovers a stale marker from the latest nonempty monthly row', async () => {
  const store = new MemoryFileStore()
  const root = '.storyfabric/writing-stats'
  await store.writeText(`${root}/2025-12.json`, JSON.stringify([{ date: '2025-12-31', added: 10, deleted: 0, net: 10, totalWords: 150, updatedAt: 200 }]))
  await store.writeText(`${root}/2026-01.json`, '[]')
  await store.writeText(`${root}/current.json`, JSON.stringify({ totalWords: 100, updatedAt: 100 }))
  await recordChapterWriting(store, '甲', '甲乙', undefined, new Date(2026, 0, 2).getTime())
  expect(JSON.parse((await store.readText(`${root}/current.json`))!)).toMatchObject({ totalWords: 151 })
})
