import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace, listVolumes, saveVolume } from '../../workspace/workspaceService'
import {
  saveChapter,
  saveCharacter,
  saveEvent,
  saveNote,
  saveOutlineDoc,
  saveRelationships,
  saveSetting,
  listChapters,
  listNotes
} from '../../workspace/entityStore'
import { listTrash } from '../../workspace/trash'
import { executeTool, TOOL_DEFS, type ToolOutcome } from '../registry'

type R = Extract<ToolOutcome, { kind: 'result' }>
const asResult = (o: ToolOutcome): R => {
  if (o.kind !== 'result') throw new Error(`expected result, got ${o.kind}`)
  return o
}

describe('audit: 27 个工具端到端可用性', () => {
  it('读取类工具返回结果、写入类工具产出待确认并可应用', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '审核工作区')

    // ---- 种子数据 ----
    const a = await saveCharacter(store, { name: '林晚', role: '主角', content: '林晚，剑客。' })
    const b = await saveCharacter(store, { name: '沈青', role: '配角', content: '沈青，药师。' })
    await saveRelationships(store, [{ id: 'rel_seed', fromId: a.id, toId: b.id, type: '同伴', label: '', description: '同门', directed: false }])
    const evt = await saveEvent(store, { title: '雪夜相逢', storyTime: '第一章', characterIds: [a.id, b.id], content: '雪夜中相遇。' })
    const draft = await saveChapter(store, { title: '雪夜', box: 'draft', status: 'draft', content: '雪落无声。' })
    const volume = (await listVolumes(store))[0] ?? (await saveVolume(store, { title: '第一卷', order: 1 }))
    const mainChapter = await saveChapter(store, { title: '正文第一章', box: 'main', volumeId: volume.id, volume: volume.title, content: '正文内容。' })
    await saveOutlineDoc(store, { title: '总纲', kind: 'total', content: '# 总纲' })
    await saveOutlineDoc(store, { title: '雪夜章纲', kind: 'chapter', chapterId: draft.id, content: '# 章纲' })
    const setting = await saveSetting(store, { title: '世界观', category: 'background', content: '一个架空世界。' })
    const note = await saveNote(store, { title: '待办', content: '补写第三章。' })

    const matrix: Array<{ tool: string; ok: boolean; note: string }> = []
    const read = async (name: string, args: unknown): Promise<R> => {
      const outcome = asResult(await executeTool(store, name, JSON.stringify(args)))
      matrix.push({ tool: name, ok: outcome.ok, note: outcome.ok ? 'ok' : outcome.text.slice(0, 60) })
      return outcome
    }
    const write = async (name: string, args: unknown): Promise<void> => {
      const outcome = await executeTool(store, name, JSON.stringify(args))
      if (outcome.kind !== 'pending') {
        matrix.push({ tool: name, ok: false, note: `未产出待确认：${JSON.stringify(outcome).slice(0, 80)}` })
        return
      }
      const applied = await outcome.apply()
      matrix.push({ tool: name, ok: applied.ok, note: `${outcome.change.title} / ${applied.text}`.slice(0, 80) })
    }

    // ---- 读取类（17 个） ----
    await read('list_characters', {})
    await read('get_character', { characterId: a.id })
    await read('get_character', { name: '沈青' })
    await read('search_project', { query: '雪' })
    await read('get_outline', {})
    await read('list_events', {})
    await read('get_event', { eventId: evt.id })
    await read('get_relations', {})
    await read('get_relations', { characterId: a.id })
    await read('list_chapters', {})
    await read('get_chapter', { chapterId: draft.id })
    await read('get_chapter_context', { chapterId: draft.id, radius: 1 })
    await read('lookup_term', { term: '林晚' })
    await read('list_settings', {})
    await read('get_setting', { settingId: setting.id })
    await read('list_notes', {})
    await read('get_note', { noteId: note.id })
    await read('list_chapter_outlines', {})
    await read('get_chapter_outline', { chapterId: draft.id })

    // ---- 参数缺失时应给出结构化失败而不是抛错 ----
    const negatives: string[] = []
    const expectFail = async (name: string, args: unknown): Promise<string> => {
      const outcome = asResult(await executeTool(store, name, JSON.stringify(args)))
      expect(outcome.ok).toBe(false)
      negatives.push(`${name}: ${outcome.text}`)
      return outcome.text
    }
    await expectFail('get_character', {})
    await expectFail('search_project', {})
    await expectFail('get_chapter_outline', {})
    const unknown = asResult(await executeTool(store, 'no_such_tool', '{}'))
    expect(unknown.ok).toBe(false)
    expect(unknown.text).toContain('未知工具')
    const badJson = asResult(await executeTool(store, 'list_characters', '{oops'))
    expect(badJson.ok).toBe(true)

    // ---- 写入类（10 个） ----
    await write('save_character', { character: { name: '新人物', content: '简介' } })
    await write('save_relationship', { relationship: { fromCharacterId: a.id, toCharacterId: b.id, type: '师徒' } })
    await write('save_event', { event: { title: '新事件', characterIds: [a.id] } })
    await write('save_outline_doc', { doc: { title: '新章纲', kind: 'chapter', chapterId: mainChapter.id } })
    await write('save_chapter', { chapter: { title: '新草稿', box: 'draft', content: 'x' } })
    await write('save_setting', { setting: { title: '新设定', category: 'other', content: 'y' } })
    await write('save_note', { note: { title: '新便签', content: 'z' } })
    await write('delete_note', { noteId: note.id })
    await write('move_chapter', { chapterId: draft.id, box: 'main', volumeId: volume.id })
    await write('restore_from_trash', { id: (await listTrash(store))[0]?.id })

    // ---- 写入类错误路径 ----
    const badWrite = asResult(await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '没有 box' } })))
    expect(badWrite.ok).toBe(false)
    const badMove = asResult(await executeTool(store, 'move_chapter', JSON.stringify({ chapterId: 'missing', box: 'draft' })))
    expect(badMove.ok).toBe(false)

    console.log('AUDIT_MATRIX', JSON.stringify(matrix, null, 0))
    console.log('AUDIT_NEGATIVES', JSON.stringify(negatives, null, 0))
    console.log('AUDIT_TOOLS', TOOL_DEFS.length, 'chapters', (await listChapters(store)).length, 'notes', (await listNotes(store)).length)
    expect(matrix.filter((m) => !m.ok)).toEqual([])
  })
})
