import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { deleteChapter, loadChapterDocuments, loadOutlineDocuments, saveChapter } from '../../workspace/entityStore'
import { getDocumentSnapshot, saveDocument, saveHistoryVersion, listHistoryVersions, getHistoryVersion, updateHistoryVersion, deleteHistoryVersion, restoreHistoryVersion } from '../../workspace/documentWrites'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../../workspace/archive'
import { initializeWorkspace, moveChapter } from '../../workspace/workspaceService'
import { migrateWorkspace } from '../../workspace/migration'

describe('durable document history', () => {
  it('preserves initial editor content before ordinary saves and later timed capture', async () => {
    const store = new MemoryFileStore()
    const initial = await saveDocument(store, 'chapter', { title: '草稿', box: 'draft', content: '原稿 A' })
    const first = await saveDocument(store, 'chapter', { id: initial.id, content: '编辑 B' }, { baseRevision: initial.writeRevision, establishHistoryBaseline: true })
    const second = await saveDocument(store, 'chapter', { id: initial.id, content: '编辑 C' }, { baseRevision: first.writeRevision, establishHistoryBaseline: true })
    const baseline = await listHistoryVersions(store, 'chapter', initial.id)
    expect(baseline).toHaveLength(1)
    expect(baseline[0].source).toBe('baseline')
    expect((await getHistoryVersion(store, 'chapter', initial.id, baseline[0].historyVersionId)).document.content).toBe(initial.content)
    await saveHistoryVersion(store, 'chapter', initial.id, { source: 'automatic', baseRevision: second.writeRevision })
    const versions = await listHistoryVersions(store, 'chapter', initial.id)
    expect(versions.map((item) => item.source)).toEqual(['baseline', 'automatic'])
    expect((await getHistoryVersion(store, 'chapter', initial.id, versions[1].historyVersionId)).document.content).toBe(second.content)
  })
  it('validates a known source path and saves stable chapter edits without scanning other chapter files', async () => {
    class CountingStore extends MemoryFileStore {
      chapterScans = 0
      override async listFiles(directory: string, extension?: string): Promise<string[]> {
        if (directory === 'chapters' && extension === '.md') this.chapterScans++
        return super.listFiles(directory, extension)
      }
    }
    const store = new CountingStore()
    const chapter = await saveDocument(store, 'chapter', { title: '本章', box: 'draft', content: '正文' })
    const sourcePath = `chapters/${(await loadChapterDocuments(store))[0].fileName}`
    store.chapterScans = 0
    const saved = await saveDocument(store, 'chapter', { id: chapter.id, content: '改稿' }, { baseRevision: chapter.writeRevision, sourcePath })
    expect(saved.content).toContain('改稿')
    expect(store.chapterScans).toBe(0)
    await expect(saveDocument(store, 'chapter', { id: 'cha_wrong', content: '越权' }, { baseRevision: saved.writeRevision, sourcePath })).rejects.toThrow('SOURCE_CHANGED')
    await expect(saveDocument(store, 'chapter', { id: chapter.id, content: '越界' }, { baseRevision: saved.writeRevision, sourcePath: '../outside.md' })).rejects.toThrow()
  })
  it('validates current revision and raw source while saving the current document', async () => {
    const store = new MemoryFileStore()
    const chapter = await saveDocument(store, 'chapter', { title: '草稿', box: 'draft', content: '旧稿' })
    const snapshot = await getDocumentSnapshot(store, 'chapter', chapter.id)
    const updated = await saveDocument(store, 'chapter', { id: chapter.id, content: '新稿' }, { baseRevision: snapshot.writeRevision, baseText: snapshot.sourceText })
    expect(updated.writeRevision).not.toBe(snapshot.writeRevision)
    await expect(saveDocument(store, 'chapter', { id: chapter.id, content: '过期稿' }, { baseRevision: snapshot.writeRevision })).rejects.toThrow('SOURCE_CHANGED')
    await expect(saveDocument(store, 'chapter', { id: chapter.id, content: '无基线稿' })).rejects.toThrow('SOURCE_CHANGED')
    const latest = await getDocumentSnapshot(store, 'chapter', chapter.id)
    const path = `chapters/${(await loadChapterDocuments(store))[0].fileName}`
    await store.writeText(path, latest.sourceText.replace('新稿', '外部稿'))
    await expect(saveDocument(store, 'chapter', { id: chapter.id, content: '覆盖外部' }, { baseRevision: latest.writeRevision, baseText: latest.sourceText })).rejects.toThrow('SOURCE_CHANGED')
    expect(await store.readText(path)).toContain('外部稿')
  })

  it('preserves an external metadata edit made while a box move is being prepared', async () => {
    class MoveRaceStore extends MemoryFileStore {
      injectPath = ''
      override async readText(path: string): Promise<string | null> {
        if (this.injectPath && path === 'chapters/volumes.json') {
          const chapterPath = this.injectPath
          this.injectPath = ''
          const original = await super.readText(chapterPath)
          await super.writeText(chapterPath, original!.replace('原标题', '外部标题'))
        }
        return super.readText(path)
      }
    }
    const store = new MoveRaceStore()
    await initializeWorkspace(store, '移动竞争')
    const chapter = await saveDocument(store, 'chapter', { title: '原标题', box: 'draft', content: '正文' })
    store.injectPath = `chapters/${(await loadChapterDocuments(store))[0].fileName}`
    await expect(moveChapter(store, chapter.id, { box: 'main', volumeId: 'vol_default' })).rejects.toThrow('SOURCE_CHANGED')
    expect((await getDocumentSnapshot(store, 'chapter', chapter.id)).document.title).toBe('外部标题')
    expect((await getDocumentSnapshot(store, 'chapter', chapter.id)).document.box).toBe('draft')
  })

  it('creates a baseline and result together, without exposing usable historical revisions', async () => {
    const store = new MemoryFileStore()
    const original = await saveDocument(store, 'chapter', { title: '第一稿', content: 'A' })
    const changed = await saveDocument(store, 'chapter', { id: original.id, title: '第二稿', content: 'B' }, { baseRevision: original.writeRevision, history: { source: 'manual', label: '关键转折' } })
    const versions = await listHistoryVersions(store, 'chapter', original.id)
    expect(versions.map((version) => version.source)).toEqual(['baseline', 'manual'])
    expect(versions.map((version) => version.historySequence)).toEqual([1, 2])
    const baseline = await getHistoryVersion(store, 'chapter', original.id, versions[0].historyVersionId)
    const result = await getHistoryVersion(store, 'chapter', original.id, versions[1].historyVersionId)
    expect(baseline.document.content).toContain('A')
    expect(result.document.content).toContain('B')
    expect(result.document).not.toHaveProperty('writeRevision')
    expect(result.sourceWriteRevision).toBe(changed.writeRevision)
    expect(result.label).toBe('关键转折')
    await expect(saveDocument(store, 'chapter', { id: original.id, content: '错误' }, { baseRevision: result.historyVersionId })).rejects.toThrow('SOURCE_CHANGED')
  })

  it('isolates snapshot-only writes, immutable payloads and retained deletion protection', async () => {
    const store = new MemoryFileStore()
    const outline = await saveDocument(store, 'outline', { title: '独立章纲', kind: 'chapter', content: '事件计划' })
    const first = await saveHistoryVersion(store, 'outline', outline.id, { source: 'manual' })
    const immutableRaw = await store.readText(`.storyfabric/history/outlines/${outline.id}/versions/${first.historyVersionId}.json`)
    await updateHistoryVersion(store, 'outline', outline.id, first.historyVersionId, { label: '保留结构', note: '用于比较', pinned: true })
    const loaded = await getHistoryVersion(store, 'outline', outline.id, first.historyVersionId)
    expect(loaded.pinned).toBe(true)
    expect(loaded.note).toBe('用于比较')
    expect(await store.readText(`.storyfabric/history/outlines/${outline.id}/versions/${first.historyVersionId}.json`)).toBe(immutableRaw)
    expect((await getDocumentSnapshot(store, 'outline', outline.id)).writeRevision).toBe(outline.writeRevision)
    await expect(deleteHistoryVersion(store, 'outline', outline.id, first.historyVersionId)).rejects.toThrow('保留')
    await deleteHistoryVersion(store, 'outline', outline.id, first.historyVersionId, true)
    const next = await saveHistoryVersion(store, 'outline', outline.id, { source: 'manual' })
    expect(next.historySequence).toBe(2)
  })

  it('skips identical automatic snapshots while allowing explicit manual duplicates', async () => {
    const store = new MemoryFileStore()
    const outline = await saveDocument(store, 'outline', { title: '总纲', content: '相同正文' })
    const first = await saveHistoryVersion(store, 'outline', outline.id, { source: 'automatic' })
    const duplicate = await saveHistoryVersion(store, 'outline', outline.id, { source: 'automatic' })
    expect(duplicate.historyVersionId).toBe(first.historyVersionId)
    const manual = await saveHistoryVersion(store, 'outline', outline.id, { source: 'manual' })
    expect(manual.historyVersionId).not.toBe(first.historyVersionId)
    expect(await listHistoryVersions(store, 'outline', outline.id)).toHaveLength(2)
  })

  it('rejects snapshot-only checkpoints if another writer changed the editor baseline', async () => {
    const store = new MemoryFileStore()
    const original = await saveDocument(store, 'outline', { title: '计划', content: '编辑器稿' })
    const editor = await getDocumentSnapshot(store, 'outline', original.id)
    await saveDocument(store, 'outline', { id: original.id, content: '另一窗口稿' }, { baseRevision: editor.writeRevision })
    await expect(saveHistoryVersion(store, 'outline', original.id, { source: 'automatic', baseRevision: editor.writeRevision, baseText: editor.sourceText })).rejects.toThrow('SOURCE_CHANGED')
    expect(await listHistoryVersions(store, 'outline', original.id)).toEqual([])
  })

  it('rolls back current content and history when the writing statistics marker cannot persist', async () => {
    class FailingWritingStore extends MemoryFileStore {
      failMarker = false
      override async writeText(path: string, text: string): Promise<void> {
        if (this.failMarker && path === '.storyfabric/writing-stats/current.json') { this.failMarker = false; throw new Error('writing marker disk full') }
        await super.writeText(path, text)
      }
    }
    const store = new FailingWritingStore()
    const original = await saveDocument(store, 'chapter', { title: '统计事务', content: '原文' })
    const source = await getDocumentSnapshot(store, 'chapter', original.id)
    const statsFile = (await store.listFiles('.storyfabric/writing-stats', '.json')).find((name) => name !== 'current.json')!
    const beforeStats = await store.readText(`.storyfabric/writing-stats/${statsFile}`)
    store.failMarker = true
    await expect(saveDocument(store, 'chapter', { id: original.id, content: '扩写的新正文' }, { baseRevision: original.writeRevision, history: { source: 'manual' } })).rejects.toThrow('writing marker disk full')
    expect((await getDocumentSnapshot(store, 'chapter', original.id)).sourceText).toBe(source.sourceText)
    expect(await store.readText(`.storyfabric/writing-stats/${statsFile}`)).toBe(beforeStats)
    expect(await listHistoryVersions(store, 'chapter', original.id)).toEqual([])
  })

  it('restores editable fields with fresh revision, preserves placement, and keeps before/after history', async () => {
    const store = new MemoryFileStore()
    const original = await saveDocument(store, 'chapter', { title: '旧标题', box: 'draft', status: 'draft', volumeId: 'vol_old', order: 1, content: '旧内容' })
    const first = await saveHistoryVersion(store, 'chapter', original.id, { source: 'manual' })
    const current = await saveDocument(store, 'chapter', { id: original.id, title: '新标题', box: 'main', status: 'final', volumeId: 'vol_now', order: 8, content: '新内容' }, { baseRevision: original.writeRevision })
    const restored = await restoreHistoryVersion(store, 'chapter', original.id, first.historyVersionId, current.writeRevision)
    expect(restored.document.title).toBe('旧标题')
    expect(restored.document.content).toContain('旧内容')
    expect(restored.document).toMatchObject({ id: original.id, box: 'main', volumeId: 'vol_now', order: 8, status: 'final' })
    expect(restored.writeRevision).not.toBe(current.writeRevision)
    expect(restored.writeRevision).not.toBe(original.writeRevision)
    const versions = await listHistoryVersions(store, 'chapter', original.id)
    expect(versions.map((version) => version.source)).toEqual(['manual', 'before-restore', 'restored'])
    expect(versions.at(-1)?.restoredFromHistoryVersionId).toBe(first.historyVersionId)
    expect((await getHistoryVersion(store, 'chapter', original.id, first.historyVersionId)).document.content).toContain('旧内容')
  })

  it('keeps orphaned history readable and discovers it after current document deletion', async () => {
    const store = new MemoryFileStore()
    const chapter = await saveDocument(store, 'chapter', { title: '被删除章节', content: '历史正文' })
    const saved = await saveHistoryVersion(store, 'chapter', chapter.id, { source: 'manual' })
    await deleteChapter(store, chapter.id)
    expect(await listHistoryVersions(store, 'chapter')).toHaveLength(1)
    expect((await getHistoryVersion(store, 'chapter', chapter.id, saved.historyVersionId)).document.title).toBe('被删除章节')
    await expect(restoreHistoryVersion(store, 'chapter', chapter.id, saved.historyVersionId, chapter.writeRevision)).rejects.toThrow('NOT_FOUND')
  })

  it('rolls back a moved current document and both snapshot files on transaction failure', async () => {
    class FailingHistoryStore extends MemoryFileStore {
      failHistory = false
      override async writeText(path: string, text: string): Promise<void> {
        if (this.failHistory && path.includes('/versions/')) { this.failHistory = false; throw new Error('snapshot disk full') }
        await super.writeText(path, text)
      }
    }
    const store = new FailingHistoryStore()
    const chapter = await saveDocument(store, 'chapter', { title: '原章', box: 'draft', content: '保留原稿' })
    const before = await getDocumentSnapshot(store, 'chapter', chapter.id)
    store.failHistory = true
    await expect(saveDocument(store, 'chapter', { id: chapter.id, title: '改名', content: '修改' }, { baseRevision: before.writeRevision, history: { source: 'manual' } })).rejects.toThrow('事务失败')
    expect((await getDocumentSnapshot(store, 'chapter', chapter.id)).sourceText).toBe(before.sourceText)
    expect(await listHistoryVersions(store, 'chapter', chapter.id)).toEqual([])
    expect(await store.listFiles('chapters/draft', '.md')).toHaveLength(1)
  })

  it('serializes racing writes made through wrappers with identical workspace identity', async () => {
    const original = new MemoryFileStore()
    const firstStore = new Proxy(original, { get(target, key) { if (key === 'storageIdentity') return () => 'workspace://one'; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value } })
    const secondStore = new Proxy(original, { get(target, key) { if (key === 'storageIdentity') return () => 'workspace://one'; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value } })
    const outline = await saveDocument(firstStore, 'outline', { title: '竞争', content: '初稿' })
    const results = await Promise.allSettled([
      saveDocument(firstStore, 'outline', { id: outline.id, content: '第一稿' }, { baseRevision: outline.writeRevision, history: { source: 'manual' } }),
      saveDocument(secondStore, 'outline', { id: outline.id, content: '第二稿' }, { baseRevision: outline.writeRevision, history: { source: 'manual' } })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await listHistoryVersions(original, 'outline', outline.id)).toHaveLength(2)
  })

  it('exports durable history only and regenerates current revisions when importing format 5', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '历史备份')
    const chapter = await saveDocument(store, 'chapter', { title: '正文', content: '备份稿' })
    const saved = await saveHistoryVersion(store, 'chapter', chapter.id, { source: 'manual' })
    await store.writeText('.storyfabric/transactions/leftover.json', '{}')
    await store.writeText('.storyfabric/tmp/leftover.txt', '临时')
    const archive = await exportWorkspaceArchive(store, '历史备份')
    const imported = new MemoryFileStore()
    await importWorkspaceArchive(imported, archive.bytes)
    expect((await getDocumentSnapshot(imported, 'chapter', chapter.id)).writeRevision).not.toBe(chapter.writeRevision)
    expect((await getHistoryVersion(imported, 'chapter', chapter.id, saved.historyVersionId)).document.content).toContain('备份稿')
    expect(await imported.readText('.storyfabric/transactions/leftover.json')).toBeNull()
    expect(await imported.readText('.storyfabric/tmp/leftover.txt')).toBeNull()
  })

  it('rejects legacy formats before rewriting or removing any original file', async () => {
    const store = new MemoryFileStore()
    const metadata = JSON.stringify({ app: 'storyfabric', version: 4, name: '旧格式' })
    await store.writeText('storyfabric.json', metadata)
    await store.writeText('chapters/legacy.md', '旧稿')
    await expect(migrateWorkspace(store)).rejects.toThrow('格式 5')
    expect(await store.readText('storyfabric.json')).toBe(metadata)
    expect(await store.readText('chapters/legacy.md')).toBe('旧稿')
  })
})
