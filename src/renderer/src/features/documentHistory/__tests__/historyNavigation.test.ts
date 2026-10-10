import { describe, expect, it, vi } from 'vitest'
import { createDocumentHistoryNavigationGuard } from '../historyNavigation'

function deferred() {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>((done) => { resolve = done })
  return { promise, resolve }
}

function setup(paths = ['outline', 'chapters'], initial = paths.length - 1) {
  const entries = paths.map((path, idx) => ({ href: `https://app.test/#/${path}`, state: { idx, key: `key-${idx}` } }))
  let index = initial
  const traversalQueue: number[] = []
  const routeChanges: string[] = []
  const answer = deferred()
  const beforeLeave = vi.fn(() => answer.promise)
  const go = vi.fn((delta: number) => { traversalQueue.push(index + delta) })
  const guard = createDocumentHistoryNavigationGuard({ readLocation: () => entries[index], go, shouldGuard: () => true, beforeLeave })
  const visit = (destination: number): void => {
    index = destination
    let stopped = false
    guard.onPopState({ stopImmediatePropagation: () => { stopped = true } })
    if (!stopped) routeChanges.push(entries[index].href)
  }
  const flush = (): void => { const destination = traversalQueue.shift(); if (destination !== undefined) visit(destination) }
  return { entries, answer, beforeLeave, go, guard, visit, flush, routeChanges, getIndex: () => index }
}

describe('guarded browser history traversal', () => {
  it('preserves the destination entry and current entry when a failed save is cancelled', async () => {
    const history = setup()
    const originalEntries = structuredClone(history.entries)
    history.visit(0)
    expect(history.go).toHaveBeenCalledWith(1)
    expect(history.routeChanges).toEqual([])
    history.flush()
    expect(history.beforeLeave).toHaveBeenCalledOnce()
    history.answer.resolve(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(history.getIndex()).toBe(1)
    expect(history.entries).toEqual(originalEntries)
    expect(history.routeChanges).toEqual([])
    history.visit(0)
    history.flush()
    expect(history.beforeLeave).toHaveBeenCalledTimes(2)
  })
  it('replays an approved Back to the original destination while preserving Forward', async () => {
    const history = setup()
    history.visit(0)
    history.flush()
    history.answer.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(history.go.mock.calls).toEqual([[1], [-1]])
    history.flush()
    expect(history.getIndex()).toBe(0)
    expect(history.routeChanges).toEqual(['https://app.test/#/outline'])
    expect(history.entries[1]).toEqual({ href: 'https://app.test/#/chapters', state: { idx: 1, key: 'key-1' } })
  })
  it.each([false, true])('restores rapid Back clicks while one decision is pending (allowed=%s)', async (allowed) => {
    const history = setup(['characters', 'outline', 'chapters'])
    history.visit(1)
    history.flush()
    history.visit(1)
    history.visit(0)
    history.answer.resolve(allowed)
    await Promise.resolve()
    await Promise.resolve()
    expect(history.beforeLeave).toHaveBeenCalledOnce()
    history.flush()
    history.flush()
    history.flush()
    expect(history.getIndex()).toBe(allowed ? 1 : 2)
    expect(history.routeChanges).toEqual(allowed ? ['https://app.test/#/outline'] : [])
    expect(history.entries.map((entry) => entry.href)).toEqual(['https://app.test/#/characters', 'https://app.test/#/outline', 'https://app.test/#/chapters'])
  })
  it('also restores and replays a guarded Forward traversal', async () => {
    const history = setup(['chapters', 'outline'], 0)
    history.visit(1)
    history.flush()
    history.answer.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(history.go.mock.calls).toEqual([[-1], [1]])
    history.flush()
    expect(history.routeChanges).toEqual(['https://app.test/#/outline'])
  })
  it('does not replay a pending traversal after the workspace layout unmounts', async () => {
    const history = setup()
    history.visit(0)
    history.flush()
    history.guard.dispose()
    history.answer.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(history.go).toHaveBeenCalledOnce()
    expect(history.routeChanges).toEqual([])
  })
})
