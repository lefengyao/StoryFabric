import { expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { saveChapter, saveChapterInPlace, loadChapterDocuments, deleteChapter } from '../../workspace/entityStore'
import { restoreFromTrash } from '../../workspace/trash'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listWritingDays } from '../writingStats'

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
