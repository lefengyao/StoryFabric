import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listEvents, saveEvent } from '../../workspace/entityStore'
import { executeTool } from '../registry'

describe('event graph tool validation', () => {
  it('rejects missing volumes and character references before confirmation', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '事件校验')
    const missingVolume = await executeTool(store, 'save_event', JSON.stringify({ event: { title: '错误卷', volumeId: 'vol_missing' } }))
    expect(missingVolume.kind).toBe('result')

    const missingCharacter = await executeTool(store, 'save_event', JSON.stringify({ event: { title: '错误人物', volumeId: 'vol_default', characterIds: ['char_missing'] } }))
    expect(missingCharacter.kind).toBe('result')
  })

  it('normalizes a new mainline event to the tail and rejects a cycle', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '事件连接')
    const first = await saveEvent(store, { id: 'evt_a', title: 'A', volumeId: 'vol_default' })
    const created = await executeTool(store, 'save_event', JSON.stringify({ event: { title: 'B', volumeId: 'vol_default' } }))
    if (created.kind !== 'pending') throw new Error('expected pending event')
    expect((await created.apply()).ok).toBe(true)
    const events = await listEvents(store)
    const second = events.find((event) => event.title === 'B')!
    expect(events.find((event) => event.id === first.id)?.nextIds).toEqual([second.id])
    expect(second.prevIds).toEqual([first.id])

    const current = await executeTool(store, 'get_event', JSON.stringify({ eventId: second.id }))
    if (current.kind !== 'result') throw new Error('expected event result')
    const revision = (JSON.parse(current.text) as { revision: string }).revision
    const cycle = await executeTool(store, 'save_event', JSON.stringify({ event: { id: second.id, baseRevision: revision, title: 'B', volumeId: 'vol_default', nextIds: [first.id] } }))
    expect(cycle.kind).toBe('result')
  })
})
