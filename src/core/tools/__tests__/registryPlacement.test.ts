import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listVolumes } from '../../workspace/workspaceService'
import { getChapterBody, listChapters, listNotes, listOutline, saveChapter, saveNote, serializeNote, serializeOutlineDoc } from '../../workspace/entityStore'
import { normalizeChapterContent } from '../../workspace/chapterFormatting'
import { contentRevision } from '../../workspace/resourceRevision'
import { listTrash } from '../../workspace/trash'
import { executeTool, TOOL_DEFS, type ToolOutcome } from '../registry'

type ToolResult = Extract<ToolOutcome, { kind: 'result' }>

/** `expect(...).toBe(...)` 不是类型守卫，这里显式收窄联合类型后再断言字段。 */
function expectResult(outcome: ToolOutcome): ToolResult {
  if (outcome.kind !== 'result') throw new Error(`expected a result outcome, received ${outcome.kind}`)
  return outcome
}

describe('agent placement guardrails', () => {
  it('does not silently put an unspecified chapter write in the main box', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')

    const rejected = expectResult(await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '草稿章', status: 'draft' } })))
    expect(rejected.kind).toBe('result')
    expect(rejected.ok).toBe(false)
    expect(rejected.text).toContain('box')
    expect(await listChapters(store)).toHaveLength(0)

    const invalidVolume = expectResult(await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '错误卷章', box: 'main', volumeId: 'vol_missing' } })))
    expect(invalidVolume.kind).toBe('result')
    expect(invalidVolume.ok).toBe(false)
    expect(invalidVolume.text).toContain('目标卷')

    const pending = await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '草稿章', box: 'draft', status: 'draft', content: '草稿内容' } }))
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') await pending.apply({ saveHistory: false })
    expect((await listChapters(store))[0].box).toBe('draft')
  })

  it('requires explicit outline kind and preserves chapter outline ownership', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '正文' })

    const rejected = expectResult(await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { title: '目标章章纲' } })))
    expect(rejected.kind).toBe('result')
    expect(rejected.ok).toBe(false)
    expect(rejected.text).toContain('kind')

    const invalidChapter = expectResult(await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { title: '不存在的章纲', kind: 'chapter', chapterId: 'cha_missing' } })))
    expect(invalidChapter.kind).toBe('result')
    expect(invalidChapter.ok).toBe(false)
    expect(invalidChapter.text).toContain('未找到章纲关联的章节')

    const pending = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { title: '目标章章纲', kind: 'chapter', chapterId: chapter.id, content: '# 章纲' } }))
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') await pending.apply({ saveHistory: false })
    const outline = (await listOutline(store)).find((doc) => doc.title === '目标章章纲')
    expect(outline?.kind).toBe('chapter')
    expect(outline?.chapterId).toBe(chapter.id)
  })

  it('lets the agent save a chapter outline before any chapter exists and attach it later', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '先章纲后正文')

    const pending = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { title: '第一章章纲', kind: 'chapter', content: '先写章纲' } }))
    expect(pending.kind).toBe('pending')
    if (pending.kind !== 'pending') return
    await pending.apply({ saveHistory: false })

    const unbound = (await listOutline(store)).find((doc) => doc.title === '第一章章纲')!
    expect(unbound.chapterId).toBeUndefined()
    expect(await listChapters(store)).toHaveLength(0)
    expect(await store.listFiles('outline/unassigned', '.md')).toHaveLength(1)

    const chapter = await saveChapter(store, { title: '第一章', box: 'draft', content: '' })
    const linked = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: {
      id: unbound.id, baseRevision: contentRevision(serializeOutlineDoc(unbound)), kind: 'chapter', chapterId: chapter.id
    } }))
    expect(linked.kind).toBe('pending')
    if (linked.kind !== 'pending') return
    await linked.apply({ saveHistory: false })

    const outline = (await listOutline(store)).find((doc) => doc.id === unbound.id)!
    expect(outline.chapterId).toBe(chapter.id)
    expect(outline.content).toBe('先写章纲')
    expect(await store.listFiles('outline/unassigned', '.md')).toHaveLength(0)
    expect(await store.listFiles(`outline/chapters/${chapter.id}`, '.md')).toHaveLength(1)

    const detached = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: {
      id: outline.id, baseRevision: contentRevision(serializeOutlineDoc(outline)), kind: 'chapter', chapterId: ''
    } }))
    expect(detached.kind).toBe('pending')
    if (detached.kind !== 'pending') return
    await detached.apply({ saveHistory: false })
    expect((await listOutline(store)).find((doc) => doc.id === outline.id)?.chapterId).toBeUndefined()
    expect(await store.listFiles('outline/unassigned', '.md')).toHaveLength(1)
    expect(await store.listFiles(`outline/chapters/${chapter.id}`, '.md')).toHaveLength(0)
  })

  it('rejects delete_note without a valid noteId or for an unknown note', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')

    const missingId = expectResult(await executeTool(store, 'delete_note', JSON.stringify({})))
    expect(missingId.kind).toBe('result')
    expect(missingId.ok).toBe(false)
    expect(missingId.text).toContain('noteId')

    const unknownId = expectResult(await executeTool(store, 'delete_note', JSON.stringify({ noteId: 'note_missing' })))
    expect(unknownId.kind).toBe('result')
    expect(unknownId.ok).toBe(false)
    expect(unknownId.text).toContain('未找到便签')
    expect(unknownId.text).toContain('note_missing')
  })

  it('rejects empty and whitespace-only delete_note noteIds', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')

    for (const noteId of ['', '   ']) {
      const rejected = expectResult(await executeTool(store, 'delete_note', JSON.stringify({ noteId })))
      expect(rejected.kind).toBe('result')
      expect(rejected.ok).toBe(false)
      expect(rejected.text).toContain('有效 noteId')
    }
  })

  it('registers delete_note with a required string noteId schema', () => {
    const definition = TOOL_DEFS.find((tool) => tool.name === 'delete_note')
    expect(definition).toBeDefined()
    expect(definition?.parameters.properties).toEqual(expect.objectContaining({ noteId: expect.objectContaining({ type: 'string' }) }))
    expect(definition?.parameters.required).toEqual(expect.arrayContaining(['noteId']))
    expect(definition?.description).toBe('只有用户明确同意删除已完成便签后才能调用；将便签移入回收站，需要用户确认。')
  })

  it('documents that existing chapter content must use fragment tools', () => {
    const definition = TOOL_DEFS.find((tool) => tool.name === 'save_chapter')
    expect(definition?.description).toContain('已有章节禁止通过 content 或 replaceAll 整章覆盖')
    expect(definition?.description).toContain('edit_chapter')
    expect(definition?.description).toContain('append_chapter')
  })

  it('edits only the requested chapter fragment and rejects stale or ambiguous anchors', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '精确章节编辑')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '第一行背景内容用于章节版本保护\n第二行\n第一行结尾内容用于确认没有覆盖全文' })
    const revision = contentRevision((await import('../../workspace/entityStore')).serializeChapter(chapter))

    const pending = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: revision,
      expectedText: '第二行',
      replacement: '第二行（修订）'
    }))
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') expect((await pending.apply({ saveHistory: false })).ok).toBe(true)
    expect(await getChapterBody(store, chapter.id)).toBe(normalizeChapterContent('第一行背景内容用于章节版本保护\n第二行（修订）\n第一行结尾内容用于确认没有覆盖全文'))

    const stale = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: revision,
      expectedText: '第二行',
      replacement: '不应覆盖'
    }))
    expect(stale.kind).toBe('result')
    if (stale.kind === 'result') expect(stale.ok).toBe(false)

    const current = await import('../../workspace/entityStore')
    const latest = (await current.loadChapterDocuments(store)).find((item) => item.doc.id === chapter.id)?.doc
    if (!latest) throw new Error('章节丢失')
    const ambiguous = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: contentRevision(current.serializeChapter(latest)),
      expectedText: '第一行',
      replacement: '第一行（修订）'
    }))
    expect(ambiguous.kind).toBe('result')
    if (ambiguous.kind === 'result') expect(ambiguous.text).toContain('出现多次')
  })

  it('deletes an exact line without leaving a blank placeholder', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '删除章节行')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '第一行\n待删除\n第三行' })
    const current = await import('../../workspace/entityStore')
    const revision = contentRevision(current.serializeChapter(chapter))

    const pending = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: revision,
      lineStart: 2,
      lineEnd: 2,
      replacement: ''
    }))
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') expect((await pending.apply({ saveHistory: false })).ok).toBe(true)
    expect(await getChapterBody(store, chapter.id)).toBe('　　第一行\n第三行')
  })

  it('rejects chapter edits that replace the whole chapter', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '整章编辑防护')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '第一段\n\n第二段\n\n第三段' })
    const current = await import('../../workspace/entityStore')
    const revision = contentRevision(current.serializeChapter(chapter))

    const byLines = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: revision,
      lineStart: 1,
      lineEnd: 5,
      replacement: '重写后的整章'
    }))
    const byWholeText = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: revision,
      expectedText: chapter.content,
      replacement: '重写后的整章'
    }))

    expect(byLines.kind).toBe('result')
    expect(byWholeText.kind).toBe('result')
    if (byLines.kind === 'result') expect(byLines.text).toContain('局部片段')
    if (byWholeText.kind === 'result') expect(byWholeText.text).toContain('局部片段')
    expect(await getChapterBody(store, chapter.id)).toContain('第一段')
  })

  it('rejects a short chapter anchor replaced with a large block of new text', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '章节替换长度限制')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '第一段\n\n第二段\n\n第三段' })
    const current = await import('../../workspace/entityStore')
    const revision = contentRevision(current.serializeChapter(chapter))

    const outcome = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: revision,
      expectedText: '第一段',
      replacement: '新正文'.repeat(20)
    }))

    expect(outcome.kind).toBe('result')
    if (outcome.kind === 'result') expect(outcome.text).toContain('局部片段')
    expect(await getChapterBody(store, chapter.id)).toContain('第一段')
  })

  it('rejects full chapter updates for existing chapters, including explicit replaceAll', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '章节局部更新门禁')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '原正文' })
    const current = await import('../../workspace/entityStore')
    const revision = contentRevision(current.serializeChapter(chapter))

    const rejected = await executeTool(store, 'save_chapter', JSON.stringify({
      chapter: { id: chapter.id, box: 'draft', baseRevision: revision, content: '整章覆盖' }
    }))
    expect(rejected.kind).toBe('result')
    if (rejected.kind === 'result') {
      expect(rejected.ok).toBe(false)
      expect(rejected.text).toContain('edit_chapter')
    }

    const explicit = await executeTool(store, 'save_chapter', JSON.stringify({
      chapter: { id: chapter.id, box: 'draft', baseRevision: revision, replaceAll: true, content: '明确整章重写' }
    }))
    expect(explicit.kind).toBe('result')
    if (explicit.kind === 'result') {
      expect(explicit.ok).toBe(false)
      expect(explicit.text).toContain('edit_chapter')
      expect(explicit.text).toContain('append_chapter')
    }
    expect(await getChapterBody(store, chapter.id)).toBe('　　原正文')
  })

  it('updates an existing chapter without rescanning every chapter during approval apply', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '章节保存性能')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '旧正文' })
    for (let index = 0; index < 24; index += 1) {
      await saveChapter(store, { title: `其他章${index}`, box: 'draft', content: `正文${index}` })
    }
    const revision = contentRevision((await import('../../workspace/entityStore')).serializeChapter(chapter))
    const listCalls: string[] = []
    const originalListFiles = store.listFiles.bind(store)
    const originalListDirs = store.listDirs.bind(store)
    store.listFiles = async (dir, extension) => { listCalls.push(`files:${dir}:${extension ?? ''}`); return originalListFiles(dir, extension) }
    store.listDirs = async (dir) => { listCalls.push(`dirs:${dir}`); return originalListDirs(dir) }

    const pending = await executeTool(store, 'save_chapter', JSON.stringify({
      chapter: { id: chapter.id, box: 'draft', baseRevision: revision, status: 'revised' }
    }))
    expect(pending.kind).toBe('pending')
    if (pending.kind !== 'pending') return
    expect((await pending.apply({ saveHistory: false })).ok).toBe(true)
    expect(listCalls.filter((call) => call === 'files:chapters:.md').length).toBe(1)
    expect((await listChapters(store)).find((item) => item.id === chapter.id)?.status).toBe('revised')
  })

  it('creates a note pending change and only moves the note to trash when applied', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const note = await saveNote(store, { title: '待清理便签', tags: ['测试'], content: '便签内容' })

    const pending = await executeTool(store, 'delete_note', JSON.stringify({ noteId: note.id }))
    expect(pending.kind).toBe('pending')
    if (pending.kind !== 'pending') return

    expect(pending.change.toolName).toBe('delete_note')
    expect(pending.change.entityKind).toBe('note')
    expect(pending.change.entityId).toBe(note.id)
    expect(pending.change.title).toBe('删除便签：待清理便签')
    expect(pending.change.beforeText).toBe(serializeNote(note))
    expect(pending.change.afterText).toContain('移入回收站')
    expect(await listNotes(store)).toHaveLength(1)
    expect(await listTrash(store)).toHaveLength(0)

    const applied = await pending.apply({ saveHistory: false })
    expect(applied.ok).toBe(true)
    expect(applied.text).toContain('移入回收站')
    expect(await listNotes(store)).toHaveLength(0)
    expect(await listTrash(store)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: note.id, kind: 'note', title: note.title })
    ]))
  })

  it('creates a volume only after approval and rejects duplicate titles', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '分卷工具')
    const definition = TOOL_DEFS.find((tool) => tool.name === 'create_volume')
    expect(definition?.parameters.required).toEqual(expect.arrayContaining(['title']))

    const pending = await executeTool(store, 'create_volume', JSON.stringify({ title: '第二卷' }))
    expect(pending.kind).toBe('pending')
    if (pending.kind !== 'pending') return
    expect((await listVolumes(store)).map((volume) => volume.title)).toEqual(['第一卷'])
    expect((await pending.apply({ saveHistory: false })).ok).toBe(true)
    expect((await listVolumes(store)).map((volume) => volume.title)).toContain('第二卷')

    const duplicate = await executeTool(store, 'create_volume', JSON.stringify({ title: '第二卷' }))
    expect(duplicate.kind).toBe('result')
    if (duplicate.kind === 'result') {
      expect(duplicate.ok).toBe(false)
      expect(duplicate.text).toContain('卷名已存在')
    }
  })
})
