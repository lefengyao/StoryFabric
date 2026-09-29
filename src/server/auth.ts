import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface AccessKeyVerifier {
  verify(candidate: string): boolean
}

/** Compare fixed-size digests so the configured key length is not observable. */
export function createAccessKeyVerifier(expectedKey: string): AccessKeyVerifier {
  if (!expectedKey) throw new Error('STORYFABRIC_ACCESS_KEY 不能为空')
  const expected = digest(expectedKey)
  return {
    verify(candidate: string): boolean {
      const actual = digest(candidate)
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    }
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export interface AuthAttemptTracker {
  isBlocked(address: string): boolean
  recordFailure(address: string): void
  clear(address: string): void
  size(): number
}

/**
 * Bound failed-login bookkeeping so spoofed or high-cardinality source addresses
 * cannot grow the server map without limit.
 */
export function createAuthAttemptTracker(options: {
  windowMs?: number
  maxAttempts?: number
  maxEntries?: number
  now?: () => number
} = {}): AuthAttemptTracker {
  const windowMs = Math.max(1, options.windowMs ?? 60_000)
  const maxAttempts = Math.max(1, options.maxAttempts ?? 10)
  const maxEntries = Math.max(1, options.maxEntries ?? 4_096)
  const now = options.now ?? Date.now
  const attempts = new Map<string, { count: number; resetAt: number }>()

  const prune = (at: number): void => {
    for (const [address, attempt] of attempts) {
      if (attempt.resetAt <= at) attempts.delete(address)
    }
    while (attempts.size > maxEntries) {
      const oldest = attempts.keys().next().value as string | undefined
      if (oldest === undefined) break
      attempts.delete(oldest)
    }
  }

  const current = (address: string): { count: number; resetAt: number } | null => {
    const at = now()
    prune(at)
    const attempt = attempts.get(address)
    if (!attempt || attempt.resetAt <= at) {
      if (attempt) attempts.delete(address)
      return null
    }
    return attempt
  }

  return {
    isBlocked(address: string): boolean {
      return (current(address)?.count ?? 0) >= maxAttempts
    },
    recordFailure(address: string): void {
      const at = now()
      prune(at)
      const existing = current(address)
      if (existing) {
        existing.count += 1
        return
      }
      while (attempts.size >= maxEntries) {
        const oldest = attempts.keys().next().value as string | undefined
        if (oldest === undefined) break
        attempts.delete(oldest)
      }
      attempts.set(address, { count: 1, resetAt: at + windowMs })
    },
    clear(address: string): void {
      attempts.delete(address)
    },
    size(): number {
      prune(now())
      return attempts.size
    }
  }
}

export interface SessionStore {
  issue(): string
  has(token: string): boolean
  get(token: string): { workspaceId?: string } | null
  setWorkspace(token: string, workspaceId?: string): boolean
  revoke(token: string): void
}

export function createSessionStore(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): SessionStore {
  const ttlMs = Math.max(1, options.ttlMs ?? 8 * 60 * 60 * 1000)
  const maxEntries = Math.max(1, options.maxEntries ?? 4_096)
  const now = options.now ?? Date.now
  const sessions = new Map<string, { expiresAt: number; workspaceId?: string }>()

  const prune = (at: number): void => {
    for (const [token, session] of sessions) {
      if (session.expiresAt <= at) sessions.delete(token)
    }
    while (sessions.size > maxEntries) {
      const oldest = sessions.keys().next().value as string | undefined
      if (oldest === undefined) break
      sessions.delete(oldest)
    }
  }

  const active = (token: string): { expiresAt: number; workspaceId?: string } | null => {
    const session = sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= now()) {
      sessions.delete(token)
      return null
    }
    return session
  }

  return {
    issue(): string {
      const at = now()
      prune(at)
      while (sessions.size >= maxEntries) {
        const oldest = sessions.keys().next().value as string | undefined
        if (oldest === undefined) break
        sessions.delete(oldest)
      }
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { expiresAt: at + ttlMs })
      return token
    },
    has(token: string): boolean {
      return active(token) !== null
    },
    get(token: string): { workspaceId?: string } | null {
      const session = active(token)
      return session ? { workspaceId: session.workspaceId } : null
    },
    setWorkspace(token: string, workspaceId?: string): boolean {
      const session = active(token)
      if (!session) return false
      session.workspaceId = workspaceId
      return true
    },
    revoke(token: string): void {
      sessions.delete(token)
    }
  }
}
