import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { findCharacter, getChapterBody, getNote, saveChapter, saveCharacter, saveNote, serializeChapter, serializeCharacter } from '../../workspace/entityStore'
import { contentRevision } from '../../workspace/resourceRevision'
import { normalizeChapterContent } from '../../workspace/chapterFormatting'
import { executeTool, type ToolOutcome } from '../registry'

describe('versioned agent mutations', () => {
  it('appends only new prose to an existing chapter and rejects a stale base revision', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '章节续写')
    const chapter = await saveChapter(store, { title: '第一章', box: 'draft', status: 'draft', content: '原有正文' })
    const baseRevision = contentRevision(serializeChapter(chapter))
    const appended = await executeTool(store, 'append_chapter', JSON.stringify({ chapterId: chapter.id, baseRevision, appendText: '新增段落' }))
    expect(appended.kind).toBe('pending')
    if (appended.kind !== 'pending') return
    expect((await appended.apply()).ok).toBe(true)
    expect(await getChapterBody(store, chapter.id)).toBe(normalizeChapterContent('原有正文\n\n新增段落'))
    const stale = await executeTool(store, 'append_chapter', JSON.stringify({ chapterId: chapter.id, baseRevision, appendText: '旧版本续写' }))
    expect(stale).toMatchObject({ kind: 'result', ok: false })
    expect(await getChapterBody(store, chapter.id)).toBe(normalizeChapterContent('原有正文\n\n新增段落'))
  })

  it('does not overwrite a user edit made while chapter continuation awaits approval', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '续写冲突')
    const chapter = await saveChapter(store, { title: '第一章', box: 'draft', status: 'draft', content: '旧正文' })
    const baseRevision = contentRevision(serializeChapter(chapter))
    const pending = await executeTool(store, 'append_chapter', JSON.stringify({ chapterId: chapter.id, baseRevision, appendText: '智能体续写' }))
    if (pending.kind !== 'pending') throw new Error('未生成待确认续写')
    await saveChapter(store, { id: chapter.id, content: '用户新正文' })
    expect((await pending.apply()).ok).toBe(false)
    expect(await getChapterBody(store, chapter.id)).toBe(normalizeChapterContent('用户新正文'))
  })
  it('uses a search hit writeRevision as the fragment edit base revision', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '搜索写入版本')
    const chapter = await saveChapter(store, { title: '版本章节', box: 'draft', status: 'draft', content: '开篇原始正文目前维持原样，后面保留其余章节内容用于回归测试。' })
    const search = await executeTool(store, 'search_project', JSON.stringify({ query: '原始正文' }))
    if (search.kind !== 'result' || !search.ok) throw new Error('搜索未返回命中')
    const payload = JSON.parse(search.text) as { hits: Array<{ id: string; kind: string; writeRevision?: string }> }
    const hit = payload.hits.find((item) => item.kind === 'chapter' && item.id === chapter.id)
    if (!hit) throw new Error('搜索未命中章节')
    expect(hit.writeRevision).toEqual(expect.any(String))

    const saved = await executeTool(store, 'edit_chapter', JSON.stringify({
      chapterId: chapter.id,
      baseRevision: hit.writeRevision,
      expectedText: '原始正文',
      replacement: '更新后的正文'
    }))
    expect(saved.kind).toBe('pending')
    if (saved.kind === 'pending') expect((await saved.apply()).ok).toBe(true)
    expect(await getChapterBody(store, chapter.id)).toBe(normalizeChapterContent('开篇更新后的正文目前维持原样，后面保留其余章节内容用于回归测试。'))
  })

  it('does not turn an unknown update id into a new entity', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '版本写回')
    const outcome = await executeTool(store, 'save_character', JSON.stringify({ character: { id: 'char_missing', baseRevision: 'old', content: '不应新建' } }))
    expect(outcome.kind).toBe('result')
    if (outcome.kind === 'result') expect(outcome.ok).toBe(false)
    expect(await findCharacter(store, { id: 'char_missing' })).toBeNull()
  })

  it('rejects updates without a base revision and detects edits made while waiting for confirmation', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '并发写回')
    const character = await saveCharacter(store, { name: '甲', content: '旧正文' })
    const before = serializeCharacter(character)

    const missingRevision = await executeTool(store, 'save_character', JSON.stringify({ character: { id: character.id, content: '无版本更新' } }))
    expect(missingRevision.kind).toBe('result')
    if (missingRevision.kind === 'result') expect(missingRevision.ok).toBe(false)

    const pending = await executeTool(store, 'save_character', JSON.stringify({ character: { id: character.id, baseRevision: contentRevision(before), content: '模型修改' } }))
    if (pending.kind !== 'pending') throw new Error('未生成待确认修改')
    await saveCharacter(store, { id: character.id, name: '甲', content: '用户修改' })
    const applied = await pending.apply()
    expect(applied.ok).toBe(false)
    expect((await findCharacter(store, { id: character.id }))?.content).toBe('用户修改')
  })

  it('uses the same conflict guard for deletes', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '删除冲突')
    const note = await saveNote(store, { title: '待删除', content: '旧' })
    const pending = await executeTool(store, 'delete_note', JSON.stringify({ noteId: note.id }))
    if (pending.kind !== 'pending') throw new Error('未生成待确认删除')
    await saveNote(store, { id: note.id, title: '待删除', content: '用户先改了' })
    const applied = await pending.apply()
    expect(applied.ok).toBe(false)
    expect((await getNote(store, note.id))?.content).toBe('用户先改了')
  })
})
