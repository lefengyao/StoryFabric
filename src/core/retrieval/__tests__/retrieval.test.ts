import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { saveChapter, saveSetting } from '../../workspace/entityStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { getChapterContext } from '../contextBuilder'
import { lookupTerm, searchIndex } from '../projectIndex'

describe('bounded project retrieval', () => {
  it('returns chapter neighbors within a character budget and finds lore terms', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '检索')
    for (let i = 1; i <= 5; i++) await saveChapter(store, { id: `cha_${i}`, title: `第${i}章`, order: i, content: `星门 第${i}章正文 `.repeat(20), terms: i === 3 ? [{ term: '星门', note: '核心设施' }] : [] })
    await saveSetting(store, { id: 'set_gate', title: '星门设定', content: '星门连接两地' })
    const context = await getChapterContext(store, 'cha_3', { radius: 2, maxChars: 1200 })
    expect(context.previous).toHaveLength(2)
    expect(context.next).toHaveLength(2)
    expect(context.returnedChars).toBeLessThanOrEqual(1200)
    expect((await lookupTerm(store, '星门'))[0].kind).toBe('chapter')
    expect((await searchIndex(store, '星门')).every((hit) => !hit.snippet.includes('第1章正文 第1章正文'))).toBe(true)
  })
})
