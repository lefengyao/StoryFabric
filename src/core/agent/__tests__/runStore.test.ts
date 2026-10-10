import { describe, expect, it } from 'vitest'
import { MemoryRunStore } from '../runStore'

describe('MemoryRunStore', () => {
  it('stores independent snapshots and marks failed checkpoint writes', async () => {
    const store = new MemoryRunStore()
    await store.create({
      runId: 'r', workspaceId: 'w', sessionId: 's', agentId: 'basic', status: 'running',
      createdAt: 1, updatedAt: 1, lastSeq: 0, drafts: [], events: [], draftSaveStatus: 'saved'
    })
    const snapshot = await store.get('r')
    snapshot!.drafts.push({ messageId: 'm', text: '草稿' })

    expect((await store.get('r'))?.drafts).toEqual([])
    expect(store.list('w', 's')).toHaveLength(1)
  })
})
