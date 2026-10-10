import { TRAILBLAZER_RESOURCE, TRAILBLAZER_SCOPES, type CloudIdentity } from '../../shared/cloudAccount'
import type * as Oidc from 'openid-client'

export interface CloudConfig { issuer: string; clientId: string; resourceBaseUrl: string; resource?: string; clientSecret?: string; redirectUri?: string }
/** Production account center used by the packaged desktop app. */
export const DEFAULT_PLATFORM_WEB_URL = 'https://trauser.fengyao.xin:10048'
/** Production Sub2API resource endpoint used by the packaged desktop app. */
export const DEFAULT_TRAILBLAZER_API_URL = 'https://trasub2api.fengyao.xin:10048'
export interface OAuthTransaction { verifier: string; state: string; nonce: string; redirectUri: string; expiresAt: number }
export interface CloudTokens { accessToken: string; refreshToken?: string; expiresAt: number; identity: CloudIdentity }
export function validateServiceUrl(value: string): URL {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('账户服务地址无效') }
  if (url.username || url.password || url.search || url.hash) throw new Error('账户服务地址无效')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('账户服务需要 HTTPS')
  return url
}
export function cloudConfigFromPlatformWebUrl(value: string, resourceBaseUrl = value, clientId = 'storyfabric-desktop'): CloudConfig {
  const url = validateServiceUrl(value)
  const resource = validateServiceUrl(resourceBaseUrl)
  const normalized = url.href.replace(/\/$/, '')
  return { issuer: normalized, resourceBaseUrl: resource.href.replace(/\/$/, ''), clientId, resource: TRAILBLAZER_RESOURCE }
}
export function cloudConfigFromEnv(env: NodeJS.ProcessEnv = process.env, web = false): CloudConfig | undefined {
  const issuer = env.STORYFABRIC_TRAILBLAZER_ISSUER?.trim()
  const resourceBaseUrl = env.STORYFABRIC_TRAILBLAZER_API_URL?.trim()
  if (!issuer || !resourceBaseUrl) return undefined
  const clientId = env.STORYFABRIC_TRAILBLAZER_CLIENT_ID?.trim() || (web ? '' : 'storyfabric-desktop')
  const clientSecret = web ? env.STORYFABRIC_TRAILBLAZER_CLIENT_SECRET : undefined
  const redirectUri = web ? env.STORYFABRIC_TRAILBLAZER_CALLBACK_URL?.trim() : undefined
  if (!clientId || (web && (!clientSecret || !redirectUri))) return undefined
  validateServiceUrl(issuer); validateServiceUrl(resourceBaseUrl)
  if (redirectUri) validateServiceUrl(redirectUri)
  return { issuer: validateServiceUrl(issuer).href.replace(/\/$/, ''), resourceBaseUrl: validateServiceUrl(resourceBaseUrl).href.replace(/\/$/, ''), clientId, clientSecret, redirectUri, resource: env.STORYFABRIC_TRAILBLAZER_RESOURCE?.trim() || TRAILBLAZER_RESOURCE }
}

/** Candidate discovery URLs for deployments whose outer proxy only exposes /api. */
export function discoveryCandidates(issuer: URL): string[] {
  const base = issuer.href.replace(/\/$/, '')
  return [base, `${base}/api/.well-known/openid-configuration`]
}

/** Keep metadata on the configured issuer and normalize same-origin HTTP endpoints. */
export function normalizeDiscoveredMetadata(issuer: URL, metadata: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...metadata }
  const endpointFields = ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint', 'introspection_endpoint', 'revocation_endpoint']
  for (const field of endpointFields) {
    const value = metadata[field]
    if (typeof value !== 'string') continue
    let endpoint: URL
    try { endpoint = new URL(value) } catch { delete normalized[field]; continue }
    if (endpoint.hostname !== issuer.hostname || endpoint.port !== issuer.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      delete normalized[field]
      continue
    }
    endpoint.protocol = issuer.protocol
    normalized[field] = endpoint.href
  }
  return normalized
}

export class OidcClient {
  private cached?: Promise<{ lib: typeof Oidc; configuration: Oidc.Configuration }>
  constructor(readonly config: CloudConfig) { validateServiceUrl(config.issuer); validateServiceUrl(config.resourceBaseUrl) }
  private load(): Promise<{ lib: typeof Oidc; configuration: Oidc.Configuration }> {
    return this.cached ??= (async () => {
      const lib = await import('openid-client')
      const issuer = validateServiceUrl(this.config.issuer)
      let configuration: Oidc.Configuration | undefined
      let lastError: unknown
      for (const candidate of discoveryCandidates(issuer)) {
        try {
          const discovered = await lib.discovery(new URL(candidate), this.config.clientId, this.config.clientSecret,
            this.config.clientSecret ? lib.ClientSecretPost(this.config.clientSecret) : lib.None(),
            { ...(issuer.protocol === 'http:' ? { execute: [lib.allowInsecureRequests] } : {}), timeout: 15 })
          const metadata = normalizeDiscoveredMetadata(issuer, discovered.serverMetadata() as Record<string, unknown>)
          configuration = new lib.Configuration(metadata as never, this.config.clientId, this.config.clientSecret,
            this.config.clientSecret ? lib.ClientSecretPost(this.config.clientSecret) : lib.None())
          break
        } catch (error) {
          lastError = error
        }
      }
      if (!configuration) throw lastError
      // Tokens and authorization codes are sent only to endpoints belonging to this issuer.
      for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint', 'revocation_endpoint'] as const) {
        const value = configuration.serverMetadata()[field]
        if (value && validateServiceUrl(value).origin !== issuer.origin) throw new Error('账户服务发现端点不受信任')
      }
      return { lib, configuration }
    })()
  }
  async authorize(redirectUri: string): Promise<{ transaction: OAuthTransaction; url: string }> {
    const { lib, configuration } = await this.load()
    const verifier = lib.randomPKCECodeVerifier()
    const transaction = { verifier, state: lib.randomState(), nonce: lib.randomNonce(), redirectUri, expiresAt: Date.now() + 600_000 }
    // offline_access requires explicit consent, otherwise the provider omits
    // the refresh token and the session ends with the first access token.
    const url = lib.buildAuthorizationUrl(configuration, { redirect_uri: redirectUri, response_type: 'code', scope: TRAILBLAZER_SCOPES, prompt: 'consent',
      resource: this.config.resource || TRAILBLAZER_RESOURCE, code_challenge_method: 'S256', code_challenge: await lib.calculatePKCECodeChallenge(verifier), state: transaction.state, nonce: transaction.nonce })
    return { transaction, url: url.href }
  }
  async complete(transaction: OAuthTransaction, callback: URL): Promise<CloudTokens> {
    if (transaction.expiresAt < Date.now() || callback.origin + callback.pathname !== new URL(transaction.redirectUri).origin + new URL(transaction.redirectUri).pathname) throw new Error('登录回调已过期或地址无效')
    const { lib, configuration } = await this.load()
    const result = await lib.authorizationCodeGrant(configuration, callback, { pkceCodeVerifier: transaction.verifier, expectedState: transaction.state, expectedNonce: transaction.nonce, idTokenExpected: true }, { resource: this.config.resource || TRAILBLAZER_RESOURCE })
    const claims = result.claims()
    if (!claims?.sub) throw new Error('账户服务未返回有效身份')
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + (result.expires_in || 300) * 1000,
      identity: { subject: claims.sub, ...(typeof claims.name === 'string' ? { name: claims.name } : {}), ...(typeof claims.email === 'string' ? { email: claims.email } : {}) } }
  }
  async refresh(refreshToken: string, identity: CloudIdentity): Promise<CloudTokens> {
    const { lib, configuration } = await this.load()
    const result = await lib.refreshTokenGrant(configuration, refreshToken, { resource: this.config.resource || TRAILBLAZER_RESOURCE })
    const claims = result.claims()
    if (claims && claims.sub !== identity.subject) throw new Error('刷新身份不匹配')
    return { accessToken: result.access_token, refreshToken: result.refresh_token || refreshToken, expiresAt: Date.now() + (result.expires_in || 300) * 1000, identity }
  }
  async revoke(token: string): Promise<void> { const { lib, configuration } = await this.load(); await lib.tokenRevocation(configuration, token) }
}
