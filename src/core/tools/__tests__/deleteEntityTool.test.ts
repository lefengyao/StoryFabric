import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listEvents, saveEvent, saveNote } from '../../workspace/entityStore'
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

  it('deletes an event only after confirmation and heals line connections', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '事件删除测试')
    const first = await saveEvent(store, { title: '开端', volumeId: 'vol_default', nextIds: ['evt_middle'] })
    const middle = await saveEvent(store, { id: 'evt_middle', title: '中段', volumeId: 'vol_default', prevIds: [first.id], nextIds: ['evt_end'] })
    await saveEvent(store, { id: 'evt_end', title: '结尾', volumeId: 'vol_default', prevIds: [middle.id] })

    const pending = await executeDeleteEntityTool(store, { kind: 'event', id: 'evt_middle' })
    expect(pending.kind).toBe('pending')
    expect((await listEvents(store)).map((event) => event.id)).toContain('evt_middle')
    if (pending.kind !== 'pending') throw new Error('expected pending')
    expect((await pending.apply()).ok).toBe(true)

    const remaining = await listEvents(store)
    expect(remaining.map((event) => event.id)).not.toContain('evt_middle')
    expect(remaining.find((event) => event.id === first.id)?.nextIds).toEqual(['evt_end'])
    expect(remaining.find((event) => event.id === 'evt_end')?.prevIds).toEqual([first.id])
  })
})
