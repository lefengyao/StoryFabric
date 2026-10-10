import { afterEach, describe, expect, it, vi } from 'vitest'
import { TRAILBLAZER_RESOURCE, validateCloudWrite } from '../../../shared/cloudAccount'
import { cloudConfigFromEnv, cloudConfigFromPlatformWebUrl, DEFAULT_PLATFORM_WEB_URL, DEFAULT_TRAILBLAZER_API_URL, discoveryCandidates, normalizeDiscoveredMetadata, OidcClient, validateServiceUrl } from '../oidcClient'
import { CloudAccountService, type AuthorizationLauncher } from '../cloudAccountService'
import { MemoryCloudCredentialStore } from '../cloudCredential'

describe('Trailblazer account boundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requests explicit consent so offline access can issue a refresh token', async () => {
    const origin = 'https://accounts.example'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, jwks_uri: `${origin}/oauth/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] }), { headers: { 'content-type': 'application/json' } }))
    const client = new OidcClient(cloudConfigFromPlatformWebUrl(origin))
    const authorization = new URL((await client.authorize('http://127.0.0.1:45678/oauth/callback')).url)
    expect(authorization.searchParams.get('scope')?.split(' ')).toContain('offline_access')
    expect(authorization.searchParams.get('prompt')).toBe('consent')
  })

  it('returns to signed-out before clearing credentials when an expiring session has no refresh token', async () => {
    const config = { ...cloudConfigFromPlatformWebUrl('https://accounts.example'), redirectUri: 'https://storyfabric.example/oauth/callback' }
    const now = Date.now()
    const store = new MemoryCloudCredentialStore()
    const client = {
      authorize: async (redirectUri: string) => ({ transaction: { verifier: 'verifier', state: 'expected-state', nonce: 'nonce', redirectUri, expiresAt: now + 60_000 }, url: 'https://accounts.example/oauth/authorize' }),
      complete: async () => ({ accessToken: 'short-lived-token', expiresAt: now + 300_000, identity: { subject: 'user-1' } })
    } as unknown as OidcClient
    const summary = { businessUserId: 'user-1', status: 'active', balance: { amount: 0, currency: 'USD' }, connection: { applicationId: 'storyfabric', status: 'active', credentialVersion: 1, configurationVersion: 1, group: null } }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: summary }))) as unknown as typeof fetch
    const service = new CloudAccountService(config, store, undefined, fetcher, client)
    await service.beginWebLogin()
    await service.completeWebLogin(new URL(`${config.redirectUri}?code=code&state=expected-state`), service.webTransactionCookie)
    expect((await service.getState()).phase).toBe('signed-in')

    vi.spyOn(Date, 'now').mockReturnValue(now + 300_000)
    let finishClear!: () => void
    vi.spyOn(store, 'clear').mockImplementationOnce(() => new Promise<void>((resolve) => { finishClear = resolve }))
    const expiredRequest = service.getAccount()
    try {
      await expect(service.getChannels()).rejects.toThrow('当前运行的账号已退出或更换')
      expect(await service.getState()).toMatchObject({ phase: 'signed-out' })
    } finally {
      finishClear()
      await expect(expiredRequest).rejects.toThrow(/登录已.*请重新登录/)
    }
    expect(await store.read()).toBeNull()
    await expect(service.modelBinding()).rejects.toThrow('请先完成 Trailblazer 登录')
  })

  it('renews an expiring login once for concurrent account requests and persists the rotated refresh token', async () => {
    const now = Date.now()
    const identity = { subject: 'user-1' }
    const store = new MemoryCloudCredentialStore()
    await store.write({ refreshToken: 'refresh-1', identity })
    const refresh = vi.fn(async (previous: string) => ({ accessToken: previous === 'refresh-1' ? 'access-1' : 'access-2', refreshToken: previous === 'refresh-1' ? 'refresh-2' : 'refresh-3', expiresAt: Date.now() + 300_000, identity }))
    const summary = { businessUserId: 'user-1', status: 'active', balance: { amount: 0, currency: 'USD' }, connection: { applicationId: 'storyfabric', status: 'active', credentialVersion: 1, configurationVersion: 1, group: null } }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: summary }))) as unknown as typeof fetch
    const service = new CloudAccountService(cloudConfigFromPlatformWebUrl('https://accounts.example'), store, undefined, fetcher, { refresh } as unknown as OidcClient)
    expect((await service.getState()).phase).toBe('signed-in')
    vi.spyOn(Date, 'now').mockReturnValue(now + 300_000)
    await expect(Promise.all([service.getAccount(), service.getAccount(), service.getAccount()])).resolves.toHaveLength(3)
    expect(refresh).toHaveBeenCalledTimes(2) // startup restore and one shared renewal
    expect(refresh).toHaveBeenLastCalledWith('refresh-2', identity)
    expect(await store.read()).toEqual({ refreshToken: 'refresh-3', identity })
    expect((await service.getState()).phase).toBe('signed-in')
  })

  it('uses the approved resource and rejects arbitrary service URLs', () => {
    expect(cloudConfigFromEnv({ STORYFABRIC_TRAILBLAZER_ISSUER: 'https://accounts.example', STORYFABRIC_TRAILBLAZER_API_URL: 'https://api.example' })?.resource).toBe(TRAILBLAZER_RESOURCE)
    expect(() => validateServiceUrl('http://example.com')).toThrow()
    expect(() => validateServiceUrl('https://user:pass@example.com')).toThrow()
  })
  it('builds same-origin desktop configuration from the Platform web URL', () => {
    expect(DEFAULT_PLATFORM_WEB_URL).toBe('https://trauser.fengyao.xin:10048')
    expect(DEFAULT_TRAILBLAZER_API_URL).toBe('https://trasub2api.fengyao.xin:10048')
    expect(cloudConfigFromPlatformWebUrl('https://accounts.example/')).toMatchObject({ issuer: 'https://accounts.example', resourceBaseUrl: 'https://accounts.example', clientId: 'storyfabric-desktop', resource: TRAILBLAZER_RESOURCE })
    expect(cloudConfigFromPlatformWebUrl('https://accounts.example', 'https://sub2api.example/').resourceBaseUrl).toBe('https://sub2api.example')
    expect(() => cloudConfigFromPlatformWebUrl('https://accounts.example/path?token=secret')).toThrow()
  })
  it('supports the deployed Platform discovery compatibility path and fixes same-origin forwarded endpoints', () => {
    expect(discoveryCandidates(new URL('https://trauser.example:10048'))).toEqual([
      'https://trauser.example:10048',
      'https://trauser.example:10048/api/.well-known/openid-configuration',
    ])
    const metadata = normalizeDiscoveredMetadata(new URL('https://trauser.example:10048'), {
      issuer: 'https://trauser.example:10048',
      authorization_endpoint: 'http://trauser.example:10048/oauth/authorize',
      token_endpoint: 'http://trauser.example:10048/oauth/token',
      jwks_uri: 'http://trauser.example:10048/oauth/jwks',
      userinfo_endpoint: 'http://trauser.example:10048/oauth/userinfo',
      introspection_endpoint: 'http://trauser.example:10048/oauth/introspect',
      revocation_endpoint: 'http://trauser.example:10048/oauth/revoke',
      unrelated: 'http://other.example/oauth/token',
    } as never)
    expect(metadata.authorization_endpoint).toBe('https://trauser.example:10048/oauth/authorize')
    expect(metadata.revocation_endpoint).toBe('https://trauser.example:10048/oauth/revoke')
    expect(metadata.unrelated).toBe('http://other.example/oauth/token')
  })
  it('clears credentials and returns to the fallback deployment config when the app override is removed', async () => {
    const store = new MemoryCloudCredentialStore()
    const fallback = cloudConfigFromEnv({ STORYFABRIC_TRAILBLAZER_ISSUER: 'https://env.example', STORYFABRIC_TRAILBLAZER_API_URL: 'https://env.example' })!
    const service = new CloudAccountService(fallback, store, undefined, fetch, undefined, { fallbackConfig: fallback, configSource: 'environment' })
    expect((await service.getConfig()).source).toBe('environment')
    await store.write({ refreshToken: 'old-refresh', identity: { subject: 'old-user' } })
    expect((await service.setPlatformWebUrl('https://app.example/')).platformWebUrl).toBe('https://app.example')
    expect(await store.read()).toBeNull()
    expect((await service.getState()).phase).toBe('signed-out')
    expect(await service.setPlatformWebUrl(null)).toEqual({ platformWebUrl: 'https://env.example', source: 'environment' })
  })
  it('requires stable idempotency and expected connection versions', () => {
    expect(() => validateCloudWrite({ operationId: 'short' })).toThrow()
    expect(() => validateCloudWrite({ operationId: 'operation_1234567890', expectedCredentialVersion: 0 })).toThrow()
    expect(() => validateCloudWrite({ operationId: 'operation_1234567890', expectedCredentialVersion: 2, groupId: 'premium' })).not.toThrow()
  })
  it('keeps memory credentials process local', async () => {
    const store = new MemoryCloudCredentialStore()
    await store.write({ refreshToken: 'opaque', identity: { subject: 'user-1' } })
    expect(store.persistent).toBe(false)
    expect(await store.read()).toEqual({ refreshToken: 'opaque', identity: { subject: 'user-1' } })
    await store.clear(); expect(await store.read()).toBeNull()
  })

  it('exposes the fixed managed provider before login without activating it', async () => {
    const config = cloudConfigFromPlatformWebUrl('https://accounts.example')
    const service = new CloudAccountService(config, new MemoryCloudCredentialStore(), undefined, fetch)
    await expect(service.publicProvider({ models: ['gpt-managed'], modelSettings: { 'gpt-managed': { reasoning: 'medium' } } })).resolves.toMatchObject({
      id: 'trailblazer-managed',
      managed: 'trailblazer',
      active: false,
      models: ['gpt-managed'],
      modelSettings: { 'gpt-managed': { reasoning: 'medium' } }
    })
  })

  it('does not stay authorizing when the loopback callback has a mismatched state', async () => {
    const config = cloudConfigFromPlatformWebUrl('https://accounts.example')
    const store = new MemoryCloudCredentialStore()
    let callback: ((url: URL) => Promise<void>) | undefined
    const launcher: AuthorizationLauncher = {
      launch: async (handler) => {
        callback = handler
        return { redirectUri: 'http://127.0.0.1:45678/oauth/callback', open: async () => undefined, close: () => undefined }
      }
    }
    const client = {
      authorize: async (redirectUri: string) => ({
        transaction: { verifier: 'verifier', state: 'expected-state', nonce: 'nonce', redirectUri, expiresAt: Date.now() + 60_000 },
        url: 'https://accounts.example/oauth/authorize'
      })
    } as unknown as OidcClient
    const service = new CloudAccountService(config, store, launcher, fetch, client)

    await expect(service.beginLogin()).resolves.toMatchObject({ phase: 'authorizing' })
    expect(callback).toBeDefined()
    await expect(callback!(new URL('http://127.0.0.1:45678/oauth/callback?code=code&state=wrong-state'))).rejects.toThrow('登录回调不匹配')
    expect(await service.getState()).toMatchObject({ phase: 'signed-out', error: '登录回调不匹配' })
  })

  it('does not stay authorizing when a web callback has an invalid transaction cookie', async () => {
    const config = { ...cloudConfigFromPlatformWebUrl('https://accounts.example'), redirectUri: 'https://storyfabric.example/oauth/callback' }
    const client = {
      authorize: async (redirectUri: string) => ({
        transaction: { verifier: 'verifier', state: 'expected-state', nonce: 'nonce', redirectUri, expiresAt: Date.now() + 60_000 },
        url: 'https://accounts.example/oauth/authorize'
      })
    } as unknown as OidcClient
    const service = new CloudAccountService(config, new MemoryCloudCredentialStore(), undefined, fetch, client)

    await expect(service.beginWebLogin()).resolves.toContain('https://accounts.example/oauth/authorize')
    await expect(service.completeWebLogin(new URL('https://storyfabric.example/oauth/callback?code=code&state=expected-state'), 'wrong-cookie')).rejects.toThrow('登录事务 Cookie 无效')
    expect(await service.getState()).toMatchObject({ phase: 'signed-out', error: '登录事务 Cookie 无效' })
  })
})
