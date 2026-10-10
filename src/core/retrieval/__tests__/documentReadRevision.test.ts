import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { getDocumentSnapshot, saveDocument } from '../../workspace/documentWrites'
import { readChapterSlice, readOutlineSlice } from '../documentReader'
import { executeContentEditTool } from '../../tools/contentEditTools'

describe('raw source paging revisions', () => {
  it.each(['chapter', 'outline'] as const)('rejects later %s pages after an external edit retaining writeRevision', async (kind) => {
    const store = new MemoryFileStore()
    const document = await saveDocument(store, kind, { title: '分页', content: 'abcdefghij' })
    const snapshot = await getDocumentSnapshot(store, kind, document.id)
    const path = kind === 'chapter' ? 'chapters/main/vol_default/0001-分页.md' : 'outline/total/0001-分页.md'
    const read = (options: { offset?: number; maxChars?: number; expectedRevision?: string }) => kind === 'chapter'
      ? readChapterSlice(store, { chapterId: document.id }, options)
      : readOutlineSlice(store, { outlineId: document.id }, options)
    const first = await read({ maxChars: 5 })
    await store.writeText(path, snapshot.sourceText.replace('abcdefghij', '0123456789'))

    await expect(read({ offset: first.nextOffset, expectedRevision: first.revision })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    await expect(read({ offset: first.nextOffset, expectedRevision: first.writeRevision })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  })

  it('guards raw outline line pages while preserving a wr_ write baseline', async () => {
    const store = new MemoryFileStore()
    const document = await saveDocument(store, 'outline', { title: '行分页', content: '第一行\n第二行' })
    const snapshot = await getDocumentSnapshot(store, 'outline', document.id)
    const result = await executeContentEditTool(store, 'read_content_lines', { kind: 'outline', id: document.id, maxLines: 1 })
    if (result.kind !== 'result') throw new Error('未返回正文页')
    const first = JSON.parse(result.text)
    await store.writeText('outline/total/0001-行分页.md', snapshot.sourceText.replace('第二行', '外部第二行'))

    await expect(executeContentEditTool(store, 'read_content_lines', { kind: 'outline', id: document.id, lineStart: first.nextLine, expectedRevision: first.writeRevision })).rejects.toThrow('SOURCE_CHANGED')
    expect(first.writeRevision).toMatch(/^wr_/)
  })

  it('keeps an old raw read token invalid after another reader explicitly reads the changed source', async () => {
    const store = new MemoryFileStore()
    const document = await saveDocument(store, 'outline', { title: '多读者', content: '旧稿abcdefghij' })
    const snapshot = await getDocumentSnapshot(store, 'outline', document.id)
    const first = await readOutlineSlice(store, { outlineId: document.id }, { maxChars: 5 })
    await store.writeText('outline/total/0001-多读者.md', snapshot.sourceText.replace('旧稿abcdefghij', '新稿0123456789'))
    const fresh = await readOutlineSlice(store, { outlineId: document.id }, { maxChars: 5 })

    expect(fresh.writeRevision).toBe(first.writeRevision)
    expect(fresh.revision).not.toBe(first.revision)
    await expect(readOutlineSlice(store, { outlineId: document.id }, { offset: first.nextOffset, expectedRevision: first.revision })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    await expect(readOutlineSlice(store, { outlineId: document.id }, { offset: first.nextOffset, expectedRevision: first.writeRevision })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    expect((await readOutlineSlice(store, { outlineId: document.id }, { offset: fresh.nextOffset, expectedRevision: fresh.revision })).content).toBe('3456789')
  })
})
