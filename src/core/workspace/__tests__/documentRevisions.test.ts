import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { loadChapterDocuments, loadOutlineDocuments, saveChapter, saveChapterInPlace, saveOutlineDoc, serializeChapter, serializeOutlineDoc } from '../entityStore'
import { contentRevision } from '../resourceRevision'
import { coordinatorFor } from '../mutationCoordinator'
import { makeTrashEntry, moveToTrash, restoreFromTrash } from '../trash'
import { getDocumentSnapshot, saveDocument } from '../documentWrites'

describe('current document revisions', () => {
  it('rotates revisions even when content goes A → B → A and when a chapter is saved in place', async () => {
    const store = new MemoryFileStore()
    const first = await saveChapter(store, { title: '草稿', box: 'draft', content: 'A' })
    const second = await saveChapter(store, { id: first.id, content: 'B' })
    const third = await saveChapter(store, { id: first.id, content: 'A' })
    const stored = (await loadChapterDocuments(store))[0]
    const fourth = await saveChapterInPlace(store, stored.fileName, { content: 'A' })
    expect(first.writeRevision).toMatch(/^wr_/)
    expect(new Set([first.writeRevision, second.writeRevision, third.writeRevision, fourth.writeRevision]).size).toBe(4)
    expect(fourth.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(contentRevision(serializeChapter(fourth))).toBe(fourth.writeRevision)
    expect(contentRevision(JSON.stringify(fourth))).toBe(fourth.writeRevision)
  })

  it('rotates outline revisions and exposes them through current resource baselines', async () => {
    const store = new MemoryFileStore()
    const first = await saveOutlineDoc(store, { title: '章纲', kind: 'chapter', content: '计划' })
    const second = await saveOutlineDoc(store, { id: first.id, content: '计划' })
    expect(first.writeRevision).toMatch(/^wr_/)
    expect(second.writeRevision).not.toBe(first.writeRevision)
    expect(contentRevision(serializeOutlineDoc(second))).toBe(second.writeRevision)
    expect(contentRevision('plain content')).toMatch(/^r1-/)
  })

  it('shares entity commit locks across adapters for the same storage root', () => {
    const source = new MemoryFileStore()
    const first = Object.assign(Object.create(source), { storageIdentity: () => 'C:\\Work\\Novel\\' })
    const second = Object.assign(Object.create(source), { storageIdentity: () => 'c:/work/novel' })
    expect(coordinatorFor(first)).toBe(coordinatorFor(second))
  })

  it.each(['chapter', 'outline'] as const)('invalidates pre-delete %s tokens after restoration from trash', async (kind) => {
    const store = new MemoryFileStore()
    const first = kind === 'chapter'
      ? await saveChapter(store, { title: '旧草稿', box: 'draft', content: '保留正文' })
      : await saveOutlineDoc(store, { title: '旧章纲', kind: 'chapter', content: '保留正文' })
    const rows = kind === 'chapter' ? await loadChapterDocuments(store) : await loadOutlineDocuments(store)
    const path = `${kind === 'chapter' ? 'chapters' : 'outline'}/${rows[0].fileName}`
    const snapshot = await getDocumentSnapshot(store, kind, first.id)
    await moveToTrash(store, makeTrashEntry({ id: first.id, kind, originalPath: path, title: first.title }))
    await restoreFromTrash(store, first.id)
    const restored = await getDocumentSnapshot(store, kind, first.id)
    expect(restored.writeRevision).not.toBe(snapshot.writeRevision)
    expect(restored.document.content).toBe(first.content)
    await expect(saveDocument(store, kind, { id: first.id, content: '旧记忆覆盖' }, { baseRevision: snapshot.writeRevision })).rejects.toThrow('SOURCE_CHANGED')
  })
})
