import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { findCharacter, getNote, saveCharacter, saveNote, serializeCharacter } from '../../workspace/entityStore'
import { contentRevision } from '../../workspace/resourceRevision'
import { executeTool } from '../registry'

describe('versioned agent mutations', () => {
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
