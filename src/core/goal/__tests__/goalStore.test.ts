import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { GoalStore } from '../goalStore'

describe('GoalStore', () => {
  it('persists and lists goal snapshots by workspace', async () => {
    const store = new GoalStore(new MemoryFileStore())
    const goal = await store.create({ workspaceId: 'w', sessionId: 's', goal: '写一章', approvalPolicy: 'strict' })
    await store.save({ ...goal, status: 'completed', completedReason: '两项验收均通过' })
    expect((await store.get(goal.id))?.completedReason).toBe('两项验收均通过')
    expect((await store.list('w')).map((item) => item.id)).toEqual([goal.id])
    expect(await store.list('other')).toEqual([])
  })

  it('returns null for malformed snapshots and rejects cross-workspace access', async () => {
    const files = new MemoryFileStore()
    await files.ensureDir('.storyfabric/goals')
    await files.writeText('.storyfabric/goals/bad.json', '{bad')
    const store = new GoalStore(files)
    expect(await store.get('bad')).toBeNull()
    const goal = await store.create({ workspaceId: 'w', sessionId: 's', goal: '目标', approvalPolicy: 'strict' })
    await expect(store.assertWorkspace(goal.id, 'other')).rejects.toThrow(/工作区/)
  })
})
