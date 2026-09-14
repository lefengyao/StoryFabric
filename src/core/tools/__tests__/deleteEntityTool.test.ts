import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listEvents, saveEvent, saveNote } from '../../workspace/entityStore'
import { listTrash } from '../../workspace/trash'
import { executeDeleteEntityTool } from '../deleteEntityTool'
import { executeTool } from '../registry'

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

  it('refuses to delete an event that owns branches', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '分支删除')
    const parent = await saveEvent(store, { title: '父事件', volumeId: 'vol_default' })
    await saveEvent(store, { title: '分支事件', volumeId: 'vol_default', branchFromId: parent.id, prevIds: [parent.id] })

    await expect(executeDeleteEntityTool(store, { kind: 'event', id: parent.id })).rejects.toThrow('直属分支')
  })

  it('restores a deleted middle event only when its neighbors are unchanged', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '事件恢复')
    const a = await saveEvent(store, { id: 'a', title: 'A', volumeId: 'vol_default', nextIds: ['b'] })
    const b = await saveEvent(store, { id: 'b', title: 'B', volumeId: 'vol_default', prevIds: ['a'], nextIds: ['c'] })
    await saveEvent(store, { id: 'c', title: 'C', volumeId: 'vol_default', prevIds: ['b'] })

    const deleted = await executeDeleteEntityTool(store, { kind: 'event', id: b.id })
    if (deleted.kind !== 'pending') throw new Error('expected pending delete')
    expect((await deleted.apply()).ok).toBe(true)
    expect((await listEvents(store)).find((event) => event.id === 'c')?.prevIds).toEqual(['a'])

    const restored = await executeTool(store, 'restore_from_trash', JSON.stringify({ id: b.id }))
    if (restored.kind !== 'pending') throw new Error('expected pending restore')
    expect((await restored.apply()).ok).toBe(true)
    const events = await listEvents(store)
    expect(events.find((event) => event.id === a.id)?.nextIds).toEqual(['b'])
    expect(events.find((event) => event.id === 'b')?.prevIds).toEqual(['a'])
    expect(events.find((event) => event.id === 'b')?.nextIds).toEqual(['c'])
    expect(events.find((event) => event.id === 'c')?.prevIds).toEqual(['b'])
  })
})
