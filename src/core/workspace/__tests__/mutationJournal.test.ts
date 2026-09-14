import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { commitTextChanges, pendingMutationJournals } from '../mutationJournal'

describe('mutation journal', () => {
  it('rolls back fully applied files when a later write fails', async () => {
    class FailingStore extends MemoryFileStore {
      fail = false
      override async writeText(path: string, text: string): Promise<void> {
        if (this.fail && path === 'b.md') throw new Error('disk full')
        await super.writeText(path, text)
      }
    }
    const store = new FailingStore()
    await store.writeText('a.md', 'A0')
    await store.writeText('b.md', 'B0')
    store.fail = true
    const result = await commitTextChanges(store, 'tx_fail', [
      { path: 'a.md', beforeText: 'A0', afterText: 'A1' },
      { path: 'b.md', beforeText: 'B0', afterText: 'B1' }
    ])
    expect(result.ok).toBe(false)
    expect(result.text).toContain('已回滚')
    expect(await store.readText('a.md')).toBe('A0')
    expect(await store.readText('b.md')).toBe('B0')
  })

  it('removes committed journals and retains pending records for inspection', async () => {
    const store = new MemoryFileStore()
    await store.writeText('a.md', 'A0')
    const result = await commitTextChanges(store, 'tx_ok', [{ path: 'a.md', beforeText: 'A0', afterText: 'A1' }])
    expect(result.ok).toBe(true)
    expect(await pendingMutationJournals(store)).toEqual([])

    await commitTextChanges(store, 'tx_pending', [{ path: 'a.md', beforeText: 'missing', afterText: 'A2' }])
    expect((await pendingMutationJournals(store)).some((record) => record.id === 'tx_pending')).toBe(true)
  })
})
