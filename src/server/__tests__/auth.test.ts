import { describe, expect, it } from 'vitest'
import { createAccessKeyVerifier, createAuthAttemptTracker, createSessionStore } from '../auth'

describe('server authentication', () => {
  it('accepts only the configured access key', () => {
    const verifier = createAccessKeyVerifier('correct-horse-battery-staple')

    expect(verifier.verify('correct-horse-battery-staple')).toBe(true)
    expect(verifier.verify('wrong-key')).toBe(false)
    expect(verifier.verify('')).toBe(false)
  })

  it('keeps failed-login tracking bounded and removes expired entries', () => {
    let now = 1_000
    const tracker = createAuthAttemptTracker({ windowMs: 100, maxEntries: 2, now: () => now })

    tracker.recordFailure('first')
    tracker.recordFailure('second')
    expect(tracker.size()).toBe(2)

    tracker.recordFailure('third')
    expect(tracker.size()).toBe(2)
    expect(tracker.isBlocked('first')).toBe(false)

    now += 101
    expect(tracker.isBlocked('second')).toBe(false)
    expect(tracker.size()).toBe(0)
  })

  it('issues and expires server sessions', () => {
    let now = 1_000
    const sessions = createSessionStore({ ttlMs: 100, now: () => now })
    const token = sessions.issue()

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(sessions.has(token)).toBe(true)
    expect(sessions.get(token)).toEqual({ workspaceId: undefined })
    sessions.setWorkspace(token, 'ws_123456789abc')
    expect(sessions.get(token)).toEqual({ workspaceId: 'ws_123456789abc' })

    now += 101
    expect(sessions.has(token)).toBe(false)
  })

  it('bounds active session storage while retaining the newest sessions', () => {
    const sessions = createSessionStore({ maxEntries: 2 })
    const first = sessions.issue()
    const second = sessions.issue()
    const third = sessions.issue()

    expect(sessions.has(first)).toBe(false)
    expect(sessions.has(second)).toBe(true)
    expect(sessions.has(third)).toBe(true)
  })
})
