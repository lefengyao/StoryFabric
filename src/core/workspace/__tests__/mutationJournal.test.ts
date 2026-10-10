import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { commitTextChanges, pendingMutationJournals } from '../mutationJournal'

describe('mutation journal', () => {
  it('uses unchanged source rows as validation guards without rewriting current files', async () => {
    class CountingStore extends MemoryFileStore {
      currentWrites = 0
      override async writeText(path: string, text: string): Promise<void> {
        if (path === 'current.md') this.currentWrites++
        await super.writeText(path, text)
      }
    }
    const store = new CountingStore()
    await store.writeText('current.md', '正文')
    store.currentWrites = 0
    const result = await commitTextChanges(store, 'guard', [
      { path: 'current.md', beforeText: '正文', afterText: '正文' },
      { path: 'history.json', beforeText: null, afterText: '快照' }
    ])
    expect(result.ok).toBe(true)
    expect(store.currentWrites).toBe(0)
  })

  it('preserves external changes introduced during the transaction and leaves a recovery journal', async () => {
    class ExternalEditStore extends MemoryFileStore {
      inject = false
      override async writeText(path: string, text: string): Promise<void> {
        await super.writeText(path, text)
        if (this.inject && path === 'a.md') { this.inject = false; await super.writeText('b.md', 'external B') }
      }
    }
    const store = new ExternalEditStore()
    await store.writeText('a.md', 'A0')
    await store.writeText('b.md', 'B0')
    store.inject = true
    const result = await commitTextChanges(store, 'external', [
      { path: 'a.md', beforeText: 'A0', afterText: 'A1' },
      { path: 'b.md', beforeText: 'B0', afterText: 'B1' }
    ])
    expect(result.ok).toBe(false)
    expect(result.recoveryRequired).toBe(true)
    expect(await store.readText('a.md')).toBe('A0')
    expect(await store.readText('b.md')).toBe('external B')
    expect((await pendingMutationJournals(store))[0].status).toBe('recovery_required')
  })
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

  it('continues rolling back other files when one rollback read fails', async () => {
    class RollbackReadFailureStore extends MemoryFileStore {
      fail = false
      rollbackRead = false
      override async writeText(path: string, text: string): Promise<void> {
        if (this.fail && path === 'c.md') { this.rollbackRead = true; throw new Error('disk full') }
        await super.writeText(path, text)
      }
      override async readText(path: string): Promise<string | null> {
        if (this.rollbackRead && path === 'b.md') { this.rollbackRead = false; throw new Error('read failed during rollback') }
        return super.readText(path)
      }
    }
    const store = new RollbackReadFailureStore()
    for (const name of ['a', 'b', 'c']) await store.writeText(`${name}.md`, `${name}0`)
    store.fail = true
    const result = await commitTextChanges(store, 'rollback-read', ['a', 'b', 'c'].map((name) => ({ path: `${name}.md`, beforeText: `${name}0`, afterText: `${name}1` })))
    expect(result.recoveryRequired).toBe(true)
    expect(await store.readText('a.md')).toBe('a0')
    expect(await store.readText('b.md')).toBe('b1')
    expect(await store.readText('c.md')).toBe('c0')
    expect((await pendingMutationJournals(store))[0].status).toBe('recovery_required')
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
