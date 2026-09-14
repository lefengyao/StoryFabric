import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { saveChapter, saveSetting } from '../../workspace/entityStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { getChapterContext } from '../contextBuilder'
import { lookupTerm, searchIndex } from '../projectIndex'

describe('bounded project retrieval', () => {
  it('rejects non-finite chapter context limits instead of returning NaN', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const chapter = await saveChapter(store, { title: '目标', box: 'draft', content: '正文' })

    await expect(getChapterContext(store, chapter.id, { radius: 'abc' as unknown as number })).rejects.toThrow('radius')
    await expect(getChapterContext(store, chapter.id, { maxChars: Number.NaN })).rejects.toThrow('maxChars')
  })

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

  it('keeps draft and mainline context separate and rejects invalid limits', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '上下文')
    await saveChapter(store, { id: 'cha_a', title: '正文 A', box: 'main', volumeId: 'vol_default', order: 1, content: 'A' })
    await saveChapter(store, { id: 'cha_x', title: '草稿 X', box: 'draft', order: 2, content: 'X' })
    await saveChapter(store, { id: 'cha_b', title: '正文 B', box: 'main', volumeId: 'vol_default', order: 3, content: 'B' })

    const main = await getChapterContext(store, 'cha_a', { radius: 1, maxChars: 1200 })
    expect(main.next.map((item) => item.id)).toEqual(['cha_b'])
    const draft = await getChapterContext(store, 'cha_x', { radius: 2, maxChars: 1200 })
    expect(draft.previous).toEqual([])
    expect(draft.next).toEqual([])

    await expect(getChapterContext(store, 'cha_a', { radius: 1.5 })).rejects.toThrow('radius')
    await expect(getChapterContext(store, 'cha_a', { maxChars: 20001 })).rejects.toThrow('maxChars')
  })
})
