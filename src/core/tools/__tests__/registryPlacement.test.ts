import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listChapters, listNotes, listOutline, saveChapter, saveNote, serializeNote } from '../../workspace/entityStore'
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
    if (pending.kind === 'pending') await pending.apply()
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
    if (pending.kind === 'pending') await pending.apply()
    const outline = (await listOutline(store)).find((doc) => doc.title === '目标章章纲')
    expect(outline?.kind).toBe('chapter')
    expect(outline?.chapterId).toBe(chapter.id)
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
    expect(definition?.parameters.properties).toEqual(expect.objectContaining({ noteId: { type: 'string' } }))
    expect(definition?.parameters.required).toEqual(expect.arrayContaining(['noteId']))
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
    expect(pending.change.beforeText).toBe(serializeNote(note))
    expect(pending.change.afterText).toContain('移入回收站')
    expect(await listNotes(store)).toHaveLength(1)
    expect(await listTrash(store)).toHaveLength(0)

    const applied = await pending.apply()
    expect(applied.ok).toBe(true)
    expect(applied.text).toContain('移入回收站')
    expect(await listNotes(store)).toHaveLength(0)
    expect(await listTrash(store)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: note.id, kind: 'note', title: note.title })
    ]))
  })
})
