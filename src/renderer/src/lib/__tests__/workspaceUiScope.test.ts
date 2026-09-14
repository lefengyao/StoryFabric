import { describe, expect, it } from 'vitest'
import { identityKey, workspaceUiKey } from '../workspaceUiScope'

describe('workspace UI scope', () => {
  it('keeps the same path isolated across local and remote sources', () => {
    expect(identityKey({ source: 'http:https://one.example', path: '/same' }))
      .not.toBe(identityKey({ source: 'http:https://two.example', path: '/same' }))
    expect(identityKey({ source: 'electron-local', path: '/same' }))
      .not.toBe(identityKey({ source: 'http:https://one.example', path: '/same' }))
  })

  it('is stable and never includes a bearer token', () => {
    const first = workspaceUiKey({ source: 'http:https://server.example/storyfabric', path: 'demo' })
    const second = workspaceUiKey({ source: 'http:https://server.example/storyfabric', path: 'demo' })
    expect(first).toBe(second)
    expect(first).not.toContain('secret-token')
  })
})
