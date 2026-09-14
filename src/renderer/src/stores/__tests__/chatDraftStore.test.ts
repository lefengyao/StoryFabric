import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatDraftStore, type ChatDraftScope } from '../chatDraftStore'

const scope = (workspaceKey: string, id?: string): ChatDraftScope => ({
  workspaceKey,
  session: id ? { kind: 'existing', id } : { kind: 'new' }
})

afterEach(() => vi.useRealTimers())

describe('chat draft store', () => {
  it('isolates drafts by workspace and session and restores them from storage', () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as unknown as Storage
    const first = scope('A', 'one')
    const store = new ChatDraftStore(storage)
    store.setText(first, '  第一行\n第二行  ')
    expect(store.getText(scope('A', 'two'))).toBe('')
    expect(store.getText(scope('B', 'one'))).toBe('')
    expect(store.getText(first)).toBe('  第一行\n第二行  ')
    vi.advanceTimersByTime(250)
    expect(new ChatDraftStore(storage).getText(first)).toBe('  第一行\n第二行  ')
  })

  it('does not resurrect deleted text when an old debounce fires', () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } as unknown as Storage
    const target = scope('A', 'one')
    const store = new ChatDraftStore(storage)
    store.setText(target, '旧文字')
    store.setText(target, '')
    vi.advanceTimersByTime(250)
    expect(store.getText(target)).toBe('')
    expect([...values.values()].join('')).not.toContain('旧文字')
  })

  it('keeps memory editing available when storage throws', () => {
    vi.useFakeTimers()
    const storage = { getItem: () => { throw new Error('get failed') }, setItem: () => { throw new Error('set failed') } } as unknown as Storage
    const store = new ChatDraftStore(storage)
    const target = scope('A', 'one')
    store.setText(target, '仍可编辑')
    vi.advanceTimersByTime(250)
    expect(store.getText(target)).toBe('仍可编辑')
    expect(store.lastError).toBe('get failed')
  })

  it('clears or restores only the matching send transaction', () => {
    const store = new ChatDraftStore(null)
    const target = scope('A', 'one')
    store.setText(target, '第一条')
    const transaction = store.beginSend(target, '第一条')
    expect(store.getText(target)).toBe('')
    expect(store.clearAfterAccepted(transaction)).toBe(true)
    store.setText(target, '第二条')
    expect(store.restoreAfterFailure(transaction)).toBe(false)
    expect(store.getText(target)).toBe('第二条')
  })
})
