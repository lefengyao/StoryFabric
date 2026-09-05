import { describe, expect, it } from 'vitest'
import { createAccessKeyVerifier, createSessionStore } from '../auth'

describe('server authentication', () => {
  it('accepts only the configured access key', () => {
    const verifier = createAccessKeyVerifier('correct-horse-battery-staple')

    expect(verifier.verify('correct-horse-battery-staple')).toBe(true)
    expect(verifier.verify('wrong-key')).toBe(false)
    expect(verifier.verify('')).toBe(false)
  })

  it('issues and expires server sessions', () => {
    let now = 1_000
    const sessions = createSessionStore({ ttlMs: 100, now: () => now })
    const token = sessions.issue()

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(sessions.has(token)).toBe(true)

    now += 101
    expect(sessions.has(token)).toBe(false)
  })
})
