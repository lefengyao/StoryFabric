import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { saveNote } from '../../workspace/entityStore'
import { listTrash } from '../../workspace/trash'
import { executeDeleteEntityTool } from '../deleteEntityTool'

describe('delete_entity tool', () => {
  it('creates a pending deletion and moves supported entities to trash only after approval', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '删除测试')
    const note = await saveNote(store, { title: '待删除', content: '内容' })
    const pending = await executeDeleteEntityTool(store, { kind: 'note', id: note.id })
    expect(pending.kind).toBe('pending')
    expect((await listTrash(store)).length).toBe(0)
    if (pending.kind !== 'pending') throw new Error('expected pending')
    expect((await pending.apply()).ok).toBe(true)
    expect((await listTrash(store))[0]?.id).toBe(note.id)
  })

  it('requires confirmation and directly removes a project doc without trash support', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '文档删除测试')
    await store.writeText('docs/old.md', '旧规划')
    const pending = await executeDeleteEntityTool(store, { kind: 'projectDoc', id: 'old.md' })
    expect(pending.kind).toBe('pending')
    expect(await store.readText('docs/old.md')).toBe('旧规划')
    if (pending.kind !== 'pending') throw new Error('expected pending')
    expect((await pending.apply()).ok).toBe(true)
    expect(await store.readText('docs/old.md')).toBeNull()
  })

  it('rejects unknown kinds and missing targets', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '删除校验')
    await expect(executeDeleteEntityTool(store, { kind: 'chapter', id: 'missing' })).rejects.toThrow('未找到')
    await expect(executeDeleteEntityTool(store, { kind: 'secret', id: 'x' })).rejects.toThrow('kind')
  })
})
