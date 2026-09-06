import { createHash, randomBytes } from 'node:crypto'

export interface AccessKeyVerifier {
  verify(candidate: string): boolean
}

/** Compare fixed-size digests so the configured key length is not observable. */
export function createAccessKeyVerifier(expectedKey: string): AccessKeyVerifier {
  if (!expectedKey) throw new Error('STORYFABRIC_ACCESS_KEY 不能为空')
  const expected = digest(expectedKey)
  return {
    verify(candidate: string): boolean {
      return digest(candidate).equals(expected)
    }
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export interface SessionStore {
  issue(): string
  has(token: string): boolean
  get(token: string): { workspaceId?: string } | null
  setWorkspace(token: string, workspaceId?: string): boolean
  revoke(token: string): void
}

export function createSessionStore(options: { ttlMs?: number; now?: () => number } = {}): SessionStore {
  const ttlMs = Math.max(1, options.ttlMs ?? 8 * 60 * 60 * 1000)
  const now = options.now ?? Date.now
  const sessions = new Map<string, { expiresAt: number; workspaceId?: string }>()

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
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { expiresAt: now() + ttlMs })
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
