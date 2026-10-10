import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { getDocumentSnapshot, listHistoryVersions, saveDocument, saveHistoryVersion } from '../../workspace/documentWrites'
import { loadChapterDocuments, loadOutlineDocuments } from '../../workspace/entityStore'
import { executeTool } from '../registry'

describe('agent raw document baselines', () => {
  it.each(['save_chapter', 'edit_chapter', 'append_chapter', 'save_outline_doc'] as const)('builds %s from the same snapshot as its raw baseline when a listing races an external edit', async (name) => {
    class ReturningSourceStore extends MemoryFileStore {
      pendingPath: string | null = null
      restoredText = ''
      override async readText(path: string): Promise<string | null> {
        const text = await super.readText(path)
        if (path === this.pendingPath) { this.pendingPath = null; await super.writeText(path, this.restoredText) }
        return text
      }
    }
    const store = new ReturningSourceStore()
    await initializeWorkspace(store, '原文读取竞争')
    const kind = name === 'save_outline_doc' ? 'outline' : 'chapter'
    const original = await saveDocument(store, kind, { title: '原题', box: 'draft', kind: 'total', content: '甲处待改。模型读取的正文必须完整保留，后面的足够长正文用于保证片段修改始终在局部编辑限制内。' })
    const read = await executeTool(store, kind === 'chapter' ? 'get_chapter' : 'get_outline_doc', JSON.stringify(kind === 'chapter' ? { chapterId: original.id } : { outlineId: original.id }))
    if (read.kind !== 'result') throw new Error('读取不应生成候选变更')
    if (!read.ok) throw new Error(read.text)
    const baseline = JSON.parse(read.text)
    const rows = kind === 'chapter' ? await loadChapterDocuments(store) : await loadOutlineDocuments(store)
    const path = `${kind === 'chapter' ? 'chapters' : 'outline'}/${rows.find((row) => row.doc.id === original.id)!.fileName}`
    store.restoredText = (await store.readText(path))!
    await store.writeText(path, store.restoredText.replace('模型读取的正文', '短暂外部正文'))
    store.pendingPath = path
    const base = { baseRevision: baseline.writeRevision, baseReadRevision: baseline.readRevision }
    const args = name === 'save_chapter' ? { chapter: { id: original.id, box: 'draft', title: '新题', ...base } }
      : name === 'save_outline_doc' ? { doc: { id: original.id, kind: 'total', title: '新题', ...base } }
        : name === 'edit_chapter' ? { chapterId: original.id, expectedText: '甲处', replacement: '乙处', ...base }
          : { chapterId: original.id, appendText: '新增正文', ...base }
    const pending = await executeTool(store, name, JSON.stringify(args))
    if (pending.kind !== 'pending') throw new Error(pending.text)
    expect(pending.change.afterText).toContain('模型读取的正文')
    expect(pending.change.afterText).not.toContain('短暂外部正文')
    expect((await pending.apply({ saveHistory: false })).ok).toBe(true)
    expect((await getDocumentSnapshot(store, kind, original.id)).document.content).toContain('模型读取的正文')
  })

  it.each(['save_outline_doc', 'edit_chapter', 'edit_content'] as const)('rejects externally changed raw text before preparing %s and accepts an explicit reread', async (name) => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '读取后外部修改')
    const kind = name === 'edit_chapter' ? 'chapter' : 'outline'
    const original = await saveDocument(store, kind, { title: '原题', box: 'draft', kind: 'total', content: '甲处待改。后面的长段内容始终完整保留，用来验证局部编辑不会覆盖其他正文。' })
    const read = () => name === 'edit_content'
      ? executeTool(store, 'read_content_lines', JSON.stringify({ kind, id: original.id }))
      : executeTool(store, kind === 'chapter' ? 'get_chapter' : 'get_outline_doc', JSON.stringify(kind === 'chapter' ? { chapterId: original.id } : { outlineId: original.id }))
    const first = await read()
    if (first.kind !== 'result') throw new Error('读取不应生成候选变更')
    if (!first.ok) throw new Error(first.text)
    const revision = JSON.parse(first.text).writeRevision
    const rows = kind === 'chapter' ? await loadChapterDocuments(store) : await loadOutlineDocuments(store)
    const path = `${kind === 'chapter' ? 'chapters' : 'outline'}/${rows.find((row) => row.doc.id === original.id)!.fileName}`
    const externalText = (await store.readText(path))!.replace('甲处', '外部甲处')
    await store.writeText(path, externalText)
    const args = name === 'save_outline_doc' ? { doc: { id: original.id, kind: 'total', content: '智能体新大纲', baseRevision: revision } }
      : name === 'edit_chapter' ? { chapterId: original.id, expectedText: '甲处', replacement: '乙处', baseRevision: revision }
        : { kind, id: original.id, expectedText: '甲处', replacement: '乙处', baseRevision: revision }

    const stale = await executeTool(store, name, JSON.stringify(args))
    expect(stale).toMatchObject({ kind: 'result', ok: false })
    if (stale.kind !== 'result') throw new Error('过期原文不应生成候选变更')
    expect(JSON.parse(stale.text).error.code).toBe('SOURCE_CHANGED')
    expect(await store.readText(path)).toBe(externalText)
    expect(await listHistoryVersions(store, kind, original.id)).toEqual([])

    const reread = await read()
    if (reread.kind !== 'result') throw new Error('重新读取不应生成候选变更')
    if (!reread.ok) throw new Error(reread.text)
    const freshRead = JSON.parse(reread.text)
    expect(freshRead.writeRevision).toBe(revision)
    const withReadToken = (token: string) => name === 'save_outline_doc' ? { doc: { ...args.doc, baseReadRevision: token } } : { ...args, baseReadRevision: token }
    const oldReader = await executeTool(store, name, JSON.stringify(withReadToken(JSON.parse(first.text).readRevision)))
    expect(oldReader).toMatchObject({ kind: 'result', ok: false })
    if (oldReader.kind !== 'result') throw new Error('较新的读取不能使旧读者的原文基线重新生效')
    expect(JSON.parse(oldReader.text).error.code).toBe('SOURCE_CHANGED')
    const ambiguous = await executeTool(store, name, JSON.stringify(args))
    expect(ambiguous).toMatchObject({ kind: 'result', ok: false })
    if (ambiguous.kind !== 'result') throw new Error('已出现多种原文的当前修订必须携带原文基线')
    expect(JSON.parse(ambiguous.text).error.code).toBe('SOURCE_CHANGED')
    const fresh = await executeTool(store, name, JSON.stringify(withReadToken(freshRead.readRevision)))
    if (fresh.kind !== 'pending') throw new Error(fresh.text)
    expect((await fresh.apply({ saveHistory: true })).ok).toBe(true)
    const saved = await getDocumentSnapshot(store, kind, original.id)
    expect(saved.writeRevision).not.toBe(revision)
    expect(saved.document.content).toContain(name === 'save_outline_doc' ? '智能体新大纲' : '外部乙处')
    expect((await listHistoryVersions(store, kind, original.id)).map((version) => version.source)).toEqual(['baseline', 'agent'])
  })

  it('always validates an explicitly supplied raw token even for an unambiguous writeRevision', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '校验原文标识')
    const outline = await saveDocument(store, 'outline', { title: '原纲', content: '当前大纲' })
    const result = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { id: outline.id, kind: 'total', baseRevision: outline.writeRevision, baseReadRevision: 'rr_wrong', content: '无效覆盖' } }))
    expect(result).toMatchObject({ kind: 'result', ok: false })
    if (result.kind !== 'result') throw new Error('原文标识必须校验')
    expect(JSON.parse(result.text).error.code).toBe('SOURCE_CHANGED')
    expect((await getDocumentSnapshot(store, 'outline', outline.id)).document.content).toBe('当前大纲')
  })

  it.each(['get_outline', 'search_project'] as const)('returns a raw read token from %s and rejects that reader after an external edit', async (readName) => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '摘要读取原文标识')
    const outline = await saveDocument(store, 'outline', { title: '原纲', content: '原稿独有关键词' })
    const read = async () => {
      const result = await executeTool(store, readName, JSON.stringify(readName === 'search_project' ? { query: '独有关键词', kinds: ['outline'] } : {}))
      if (result.kind !== 'result') throw new Error('读取不应生成候选变更')
      if (!result.ok) throw new Error(result.text)
      const payload = JSON.parse(result.text)
      return (readName === 'search_project' ? payload.hits : payload).find((row: { id: string }) => row.id === outline.id)
    }
    const first = await read()
    expect(first.readRevision).toMatch(/^rr_/)
    const row = (await loadOutlineDocuments(store)).find((item) => item.doc.id === outline.id)!
    await store.writeText(`outline/${row.fileName}`, (await store.readText(`outline/${row.fileName}`))!.replace('原稿独有关键词', '外部稿独有关键词'))
    const freshRead = await read()
    expect(freshRead.writeRevision).toBe(first.writeRevision)
    expect(freshRead.readRevision).not.toBe(first.readRevision)
    const args = (baseReadRevision: string) => ({ doc: { id: outline.id, kind: 'total', content: '通过最新原文修改', baseRevision: first.writeRevision, baseReadRevision } })
    const stale = await executeTool(store, 'save_outline_doc', JSON.stringify(args(first.readRevision)))
    expect(stale).toMatchObject({ kind: 'result', ok: false })
    if (stale.kind !== 'result') throw new Error('旧摘要不能形成候选变更')
    expect(JSON.parse(stale.text).error.code).toBe('SOURCE_CHANGED')
    const fresh = await executeTool(store, 'save_outline_doc', JSON.stringify(args(freshRead.readRevision)))
    if (fresh.kind !== 'pending') throw new Error(fresh.text)
    expect((await fresh.apply({ saveHistory: false })).ok).toBe(true)
  })

  it.each(['save_chapter', 'append_chapter', 'move_chapter', 'delete_entity', 'restore_document_history'] as const)('guards the raw read token for %s before preview and accepts the fresh reader', async (name) => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '原文提交入口')
    const chapter = await saveDocument(store, 'chapter', { title: '原题', box: 'draft', content: '原正文' })
    const history = await saveHistoryVersion(store, 'chapter', chapter.id, { source: 'manual' })
    const read = async () => {
      const result = await executeTool(store, 'get_chapter', JSON.stringify({ chapterId: chapter.id }))
      if (result.kind !== 'result') throw new Error('读取不应生成候选变更')
      if (!result.ok) throw new Error(result.text)
      return JSON.parse(result.text)
    }
    const first = await read()
    const row = (await loadChapterDocuments(store)).find((item) => item.doc.id === chapter.id)!
    const path = `chapters/${row.fileName}`
    const externalText = (await store.readText(path))!.replace('原正文', '外部原正文')
    await store.writeText(path, externalText)
    const freshRead = await read()
    const args = (baseReadRevision: string) => {
      const base = { baseRevision: chapter.writeRevision, baseReadRevision }
      return name === 'save_chapter' ? { chapter: { id: chapter.id, box: 'draft', title: '新题', ...base } }
        : name === 'append_chapter' ? { chapterId: chapter.id, appendText: '新增正文', ...base }
          : name === 'move_chapter' ? { chapterId: chapter.id, box: 'main', volumeId: 'vol_default', ...base }
            : name === 'delete_entity' ? { kind: 'chapter', id: chapter.id, ...base }
              : { kind: 'chapter', id: chapter.id, historyVersionId: history.historyVersionId, ...base }
    }
    const stale = await executeTool(store, name, JSON.stringify(args(first.readRevision)))
    expect(stale).toMatchObject({ kind: 'result', ok: false })
    if (stale.kind !== 'result') throw new Error('旧原文不能生成候选变更')
    expect(JSON.parse(stale.text).error.code).toBe('SOURCE_CHANGED')
    expect(await store.readText(path)).toBe(externalText)
    const fresh = await executeTool(store, name, JSON.stringify(args(freshRead.readRevision)))
    if (fresh.kind !== 'pending') throw new Error(fresh.text)
    expect((await fresh.apply({ saveHistory: name === 'restore_document_history' })).ok).toBe(true)
    for (const file of await store.listFiles('chapters', '.md')) expect(await store.readText(`chapters/${file}`)).not.toContain('baseReadRevision')
  })

  it.each(['save_chapter', 'edit_chapter', 'append_chapter', 'save_outline_doc'] as const)('accepts a fresh CRLF source for %s and rejects subsequent external changes', async (name) => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '原文基线')
    const kind = name === 'save_outline_doc' ? 'outline' : 'chapter'
    const original = await saveDocument(store, kind, { title: '原题', box: 'draft', kind: 'total', content: '甲处待改。后面的长段内容始终完整保留，用来验证局部编辑不会覆盖其他正文。' })
    const rows = kind === 'chapter' ? await loadChapterDocuments(store) : await loadOutlineDocuments(store)
    const path = `${kind === 'chapter' ? 'chapters' : 'outline'}/${rows.find((row) => row.doc.id === original.id)!.fileName}`
    await store.writeText(path, (await store.readText(path))!.replaceAll('\n', '\r\n'))
    const args = (revision: string) => name === 'save_chapter' ? { chapter: { id: original.id, box: 'draft', title: '新题', baseRevision: revision } }
      : name === 'save_outline_doc' ? { doc: { id: original.id, kind: 'total', content: '新大纲', baseRevision: revision } }
        : name === 'edit_chapter' ? { chapterId: original.id, expectedText: '甲处', replacement: '乙处', baseRevision: revision }
          : { chapterId: original.id, appendText: '新增段落', baseRevision: revision }
    const pending = await executeTool(store, name, JSON.stringify(args(original.writeRevision)))
    if (pending.kind !== 'pending') throw new Error(pending.text)
    expect((await pending.apply({ saveHistory: false })).ok).toBe(true)
    const snapshot = await getDocumentSnapshot(store, kind, original.id)
    const nextArgs = args(snapshot.writeRevision)
    if (name === 'edit_chapter') Object.assign(nextArgs, { expectedText: '乙处', replacement: '丙处' })
    const next = await executeTool(store, name, JSON.stringify(nextArgs))
    if (next.kind !== 'pending') throw new Error(next.text)
    const currentRows = kind === 'chapter' ? await loadChapterDocuments(store) : await loadOutlineDocuments(store)
    const currentPath = `${kind === 'chapter' ? 'chapters' : 'outline'}/${currentRows.find((row) => row.doc.id === original.id)!.fileName}`
    await store.writeText(currentPath, snapshot.sourceText.replace('新题', '外部题').replace('新大纲', '外部大纲').replace('乙处', '外部甲处').replace('新增段落', '外部新增段落'))
    expect((await next.apply({ saveHistory: false })).ok).toBe(false)
    expect(await store.readText(currentPath)).toContain('外部')
  })
})
