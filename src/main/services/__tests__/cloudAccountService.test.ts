import { describe, expect, it, vi } from 'vitest'
import { loopbackLauncher } from '../cloudAccountService'

describe('desktop OAuth loopback callback', () => {
  it('delivers the callback URL and reports completion to the host app', async () => {
    let callbackUrl: URL | undefined
    const callbackStatus = vi.fn()
    const launcher = loopbackLauncher(async () => undefined, (success) => callbackStatus(success))
    const listener = await launcher.launch(async (url) => { callbackUrl = url }, () => undefined)

    try {
      const response = await fetch(`${listener.redirectUri}?code=code-1&state=state-1`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('登录完成')
      expect(callbackUrl?.pathname).toBe('/oauth/callback')
      expect(callbackUrl?.searchParams.get('code')).toBe('code-1')
      expect(callbackStatus).toHaveBeenCalledWith(true)
    } finally {
      listener.close()
    }
  })

  it('reports a failed callback and returns a retryable response', async () => {
    const callbackStatus = vi.fn()
    const launcher = loopbackLauncher(async () => undefined, (success) => callbackStatus(success))
    const listener = await launcher.launch(async () => { throw new Error('token exchange failed') }, () => undefined)

    try {
      const response = await fetch(`${listener.redirectUri}?error=access_denied`)
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('登录未完成')
      expect(callbackStatus).toHaveBeenCalledWith(false)
    } finally {
      listener.close()
    }
  })
})
