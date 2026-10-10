import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { getChapterBody, saveChapter, saveOutlineDoc } from '../../workspace/entityStore'
import { readChapterSlice, readOutlineSlice } from '../documentReader'

describe('versioned document slices', () => {
  it('reads an unbound chapter outline by outlineId before a chapter exists', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '独立章纲')
    const outline = await saveOutlineDoc(store, { title: '序章章纲', kind: 'chapter', content: '场景与转折' })
    const page = await readOutlineSlice(store, { outlineId: outline.id })
    expect(page.content).toBe('场景与转折')
    expect(page.sourcePath).toContain('outline/unassigned/')
  })

  it('reassembles long chapters exactly without truncation notices', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '分页读取')
    const content = `${'前'.repeat(8480)}尾部暗号`
    const chapter = await saveChapter(store, { title: '长章', box: 'draft', content })
    const expected = (await getChapterBody(store, chapter.id)) ?? ''

    const pages: string[] = []
    let offset: number | undefined
    let revision: string | undefined
    do {
      const page = await readChapterSlice(store, { chapterId: chapter.id }, { offset, maxChars: 8000, expectedRevision: revision })
      revision ??= page.revision
      pages.push(page.content)
      offset = page.nextOffset
      if (!page.truncated) break
    } while (offset !== undefined)

    expect(pages.join('')).toBe(expected)
    expect(pages.join('')).not.toContain('已截断')
  })

  it('keeps surrogate pairs intact and rejects a changed source on later pages', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '边界读取')
    const content = `${'甲'.repeat(7999)}😀尾部`
    const chapter = await saveChapter(store, { title: 'Emoji 章', box: 'draft', content })
    const expected = (await getChapterBody(store, chapter.id)) ?? ''
    const first = await readChapterSlice(store, { chapterId: chapter.id }, { maxChars: 8000 })
    expect(first.content.endsWith('\ud83d')).toBe(false)
    expect(first.nextOffset).toBe(8000)

    await saveChapter(store, { id: chapter.id, title: 'Emoji 章', box: 'draft', content: `${expected}改` })
    await expect(readChapterSlice(store, { chapterId: chapter.id }, { offset: first.nextOffset, expectedRevision: first.revision })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  })

  it('reads total outlines and outline docs by id, and reports duplicate chapter titles', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '大纲读取')
    const outline = await saveOutlineDoc(store, { title: '长总纲', kind: 'total', content: '纲'.repeat(650) })
    const first = await readOutlineSlice(store, { outlineId: outline.id }, { maxChars: 400 })
    const second = await readOutlineSlice(store, { outlineId: outline.id }, { offset: first.nextOffset, expectedRevision: first.revision })
    expect(first.content + second.content).toBe('纲'.repeat(650))

    await saveChapter(store, { id: 'cha_same_1', title: '重名', box: 'draft', content: '甲' })
    await saveChapter(store, { id: 'cha_same_2', title: '重名', box: 'draft', content: '乙' })
    await expect(readChapterSlice(store, { title: '重名' })).rejects.toMatchObject({ code: 'AMBIGUOUS_TARGET' })
  })
})
