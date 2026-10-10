import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { getDocumentSnapshot, listHistoryVersions, saveDocument, saveHistoryVersion } from '../../workspace/documentWrites'
import { executeDocumentHistoryTool, DOCUMENT_HISTORY_TOOL_DEFS } from '../documentHistoryTools'

describe('explicit document history agent tools', () => {
  it('pages history metadata without exposing current write tokens or document bodies', async () => {
    const store = new MemoryFileStore()
    const outline = await saveDocument(store, 'outline', { title: '大纲', content: '计划' })
    await saveHistoryVersion(store, 'outline', outline.id, { source: 'manual', label: '版本一' })
    await saveHistoryVersion(store, 'outline', outline.id, { source: 'manual', label: '版本二' })
    const first = await executeDocumentHistoryTool(store, 'list_document_history', { kind: 'outline', id: outline.id, limit: 1 })
    expect(first.kind).toBe('result')
    if (first.kind !== 'result') return
    const page = JSON.parse(first.text)
    expect(page.versions).toHaveLength(1)
    expect(page.nextOffset).toBe(1)
    expect(page.totalVersions).toBe(2)
    expect(first.text).not.toContain('wr_')
    expect(first.text).not.toContain('document')
    const second = await executeDocumentHistoryTool(store, 'list_document_history', { kind: 'outline', id: outline.id, offset: 1, limit: 1 })
    if (second.kind !== 'result') return
    expect(JSON.parse(second.text).versions[0].label).toBe('版本二')
    expect(DOCUMENT_HISTORY_TOOL_DEFS.every((definition) => definition.description.includes('用户明确'))).toBe(true)
  })

  it('pages one historical body with no writable revision and validates bounds', async () => {
    const store = new MemoryFileStore()
    const outline = await saveDocument(store, 'outline', { title: '阅读旧纲', content: 'ABCDEFGHIJ' })
    const history = await saveHistoryVersion(store, 'outline', outline.id, { source: 'manual' })
    const first = await executeDocumentHistoryTool(store, 'get_document_history', { kind: 'outline', id: outline.id, historyVersionId: history.historyVersionId, maxChars: 4 })
    if (first.kind !== 'result') throw new Error('expected result')
    expect(JSON.parse(first.text)).toMatchObject({ document: { content: 'ABCD' }, nextOffset: 4, totalChars: 10 })
    expect(first.text).not.toContain('wr_')
    const second = await executeDocumentHistoryTool(store, 'get_document_history', { kind: 'outline', id: outline.id, historyVersionId: history.historyVersionId, offset: 4, maxChars: 4 })
    if (second.kind !== 'result') throw new Error('expected result')
    expect(JSON.parse(second.text).document.content).toBe('EFGH')
    await expect(executeDocumentHistoryTool(store, 'get_document_history', { kind: 'outline', id: outline.id, historyVersionId: history.historyVersionId, maxChars: 20001 })).rejects.toThrow('maxChars')
    await expect(executeDocumentHistoryTool(store, 'list_document_history', { kind: 'outline', limit: 101 })).rejects.toThrow('limit')
  })

  it('requires true history consent before restoring with protected snapshots and current placement', async () => {
    const store = new MemoryFileStore()
    const original = await saveDocument(store, 'chapter', { title: '旧标题', box: 'draft', order: 1, content: '旧正文' })
    const history = await saveHistoryVersion(store, 'chapter', original.id, { source: 'manual' })
    const current = await saveDocument(store, 'chapter', { id: original.id, title: '新标题', box: 'main', status: 'final', volumeId: 'vol_now', order: 7, content: '当前正文' }, { baseRevision: original.writeRevision })
    const pending = await executeDocumentHistoryTool(store, 'restore_document_history', { kind: 'chapter', id: original.id, historyVersionId: history.historyVersionId, baseRevision: current.writeRevision })
    expect(pending.kind).toBe('pending')
    if (pending.kind !== 'pending') return
    expect(pending.change).toMatchObject({ toolName: 'restore_document_history', mutationKind: 'restore', historyEligible: true, historyRequired: true })
    expect(pending.change.afterText).toContain('旧正文')
    expect(pending.change.afterText).toContain('vol_now')
    expect((await pending.apply()).ok).toBe(false)
    expect((await pending.apply({ saveHistory: false })).ok).toBe(false)
    expect((await getDocumentSnapshot(store, 'chapter', original.id)).writeRevision).toBe(current.writeRevision)
    expect((await pending.apply({ saveHistory: true })).ok).toBe(true)
    const restored = await getDocumentSnapshot(store, 'chapter', original.id)
    expect(restored.document).toMatchObject({ title: '旧标题', box: 'main', volumeId: 'vol_now', order: 7, status: 'final' })
    expect(restored.document.content).toContain('旧正文')
    expect(restored.writeRevision).not.toBe(current.writeRevision)
    expect((await listHistoryVersions(store, 'chapter', original.id)).map((version) => version.source)).toEqual(['manual', 'before-restore', 'restored'])
  })

  it('rejects stale preparation and conflicts during the approval wait without snapshots', async () => {
    const store = new MemoryFileStore()
    const original = await saveDocument(store, 'outline', { title: '提纲', content: '第一稿' })
    const history = await saveHistoryVersion(store, 'outline', original.id, { source: 'manual' })
    const current = await saveDocument(store, 'outline', { id: original.id, content: '第二稿' }, { baseRevision: original.writeRevision })
    await expect(executeDocumentHistoryTool(store, 'restore_document_history', { kind: 'outline', id: original.id, historyVersionId: history.historyVersionId, baseRevision: original.writeRevision })).rejects.toThrow('SOURCE_CHANGED')
    const pending = await executeDocumentHistoryTool(store, 'restore_document_history', { kind: 'outline', id: original.id, historyVersionId: history.historyVersionId, baseRevision: current.writeRevision })
    if (pending.kind !== 'pending') throw new Error('expected pending')
    const latest = await saveDocument(store, 'outline', { id: original.id, content: '另一窗口的新稿' }, { baseRevision: current.writeRevision })
    const result = await pending.apply({ saveHistory: true })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('SOURCE_CHANGED')
    expect((await getDocumentSnapshot(store, 'outline', original.id)).writeRevision).toBe(latest.writeRevision)
    expect(await listHistoryVersions(store, 'outline', original.id)).toHaveLength(1)
  })
})
