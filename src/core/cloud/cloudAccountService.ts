import { createHash, randomBytes } from 'node:crypto'
import { getAdapter, fetchProviderModels } from '../llm'
import type { LlmAdapter } from '../llm'
import type { ManagedProviderPreferences, Protocol, ProviderPublic } from '../../shared/types'
import { TRAILBLAZER_PROVIDER_ID, TRAILBLAZER_RESOURCE, validateCloudWrite, type CloudAccountApi, type CloudAccountConfig, type CloudAccountState, type CloudAccountSummary, type CloudChannel, type CloudConnection, type CloudRedeem, type CloudUsage, type ManagedModelBinding } from '../../shared/cloudAccount'
import { cloudConfigFromPlatformWebUrl, OidcClient, type CloudConfig, type CloudTokens, type OAuthTransaction } from './oidcClient'
import type { CloudCredentialStore } from './cloudCredential'
import { resourceGroups, resourceLobby, resourceRedeem, resourceRedeems, resourceUsage } from './cloudResourceDto'

export interface AuthorizationLauncher { launch(callback: (url: URL) => Promise<void>, cancelled: () => void): Promise<{ redirectUri: string; open(url: string): Promise<void>; close(): void }> }
/**
 * OAuth diagnostics are deliberately a tiny interface so the core service does
 * not depend on Electron's logger. Implementations must redact sensitive
 * values; this service only passes URLs without query strings and boolean
 * boundary markers.
 */
export interface CloudAccountLogger {
  info(event: string, details?: unknown): void | Promise<void>
  warn?(event: string, details?: unknown): void | Promise<void>
  error?(event: string, details?: unknown): void | Promise<void>
}
export interface CloudAccountServiceOptions {
  configSource?: CloudAccountConfig['source']
  fallbackConfig?: CloudConfig
  persistPlatformWebUrl?: (url: string | null) => Promise<void>
  logger?: CloudAccountLogger
}
type Envelope<T> = { code: number; message?: string; data: T }
const PREFIX = '/api/v1/integration/storyfabric'
function connection(value: CloudConnection): CloudConnection {
  return { applicationId: String(value.applicationId), status: String(value.status), credentialVersion: Number(value.credentialVersion), configurationVersion: Number(value.configurationVersion), group: value.group ? { id: String(value.group.id), name: String(value.group.name) } : null }
}
function account(value: CloudAccountSummary): CloudAccountSummary {
  return { businessUserId: String(value.businessUserId), status: String(value.status), balance: { amount: Number(value.balance.amount), currency: String(value.balance.currency) }, connection: connection(value.connection) }
}
export class CloudAccountService implements CloudAccountApi {
  private config: CloudConfig | undefined
  private configSource: CloudAccountConfig['source']
  private readonly fallbackConfig?: CloudConfig
  private readonly persistPlatformWebUrl?: (url: string | null) => Promise<void>
  private readonly logger?: CloudAccountLogger
  private state: CloudAccountState
  private tokens?: CloudTokens
  private generation = 0
  private transaction?: OAuthTransaction
  private transactionCookie?: string
  private closeListener?: () => void
  private refreshFlight?: Promise<string>
  private summary?: CloudAccountSummary
  private ready: Promise<void>
  private oidc?: OidcClient
  private models?: string[]
  private runControllers = new Set<AbortController>()
  private onboardingId = `storyfabric_${randomOperationSuffix()}`
  constructor(config: CloudConfig | undefined, private credentials: CloudCredentialStore, private launcher?: AuthorizationLauncher, private fetcher: typeof fetch = fetch, client?: OidcClient, options: CloudAccountServiceOptions = {}) {
    this.config = config
    this.configSource = options.configSource || (config ? 'environment' : 'none')
    this.fallbackConfig = options.fallbackConfig
    this.persistPlatformWebUrl = options.persistPlatformWebUrl
    this.logger = options.logger
    this.oidc = config ? client || new OidcClient(config) : undefined
    this.state = { phase: config ? 'signed-out' : 'unconfigured', persistent: credentials.persistent }
    this.ready = this.restore()
  }
  async getConfig(): Promise<CloudAccountConfig> {
    await this.ready
    return { platformWebUrl: this.config?.issuer || '', source: this.configSource }
  }
  async setPlatformWebUrl(value: string | null): Promise<CloudAccountConfig> {
    await this.ready
    const trimmed = typeof value === 'string' ? value.trim() : ''
    const next = trimmed ? cloudConfigFromPlatformWebUrl(trimmed, this.fallbackConfig?.resourceBaseUrl || trimmed) : undefined
    if (this.persistPlatformWebUrl) await this.persistPlatformWebUrl(next?.issuer || null)
    const sameConnection = next?.issuer === this.config?.issuer && next?.resourceBaseUrl === this.config?.resourceBaseUrl
    if (sameConnection) {
      this.config = next || this.fallbackConfig
      this.configSource = next ? 'application' : this.fallbackConfig ? 'environment' : 'none'
      return { platformWebUrl: this.config?.issuer || '', source: this.configSource }
    }
    this.invalidate()
    await this.credentials.clear()
    this.config = next || this.fallbackConfig
    this.configSource = next ? 'application' : this.fallbackConfig ? 'environment' : 'none'
    this.oidc = this.config ? new OidcClient(this.config) : undefined
    this.state = { phase: this.config ? 'signed-out' : 'unconfigured', persistent: this.credentials.persistent }
    return { platformWebUrl: this.config?.issuer || '', source: this.configSource }
  }
  private async restore(): Promise<void> {
    if (!this.oidc) return
    const saved = await this.credentials.read()
    if (!saved) return
    try { this.tokens = await this.oidc.refresh(saved.refreshToken, saved.identity); await this.persist(); this.state = { phase: 'provisioning', identity: saved.identity, persistent: this.credentials.persistent }; await this.retryOnboardingInternal() }
    catch { this.tokens = undefined; await this.credentials.clear(); this.state = { phase: 'signed-out', persistent: this.credentials.persistent, error: '登录凭据已失效，请重新登录' } }
  }
  async getState(): Promise<CloudAccountState> { await this.ready; return { ...this.state, ...(this.state.identity ? { identity: { ...this.state.identity } } : {}) } }
  async beginLogin(): Promise<CloudAccountState> {
    await this.ready
    if (!this.launcher || !this.oidc || !this.config) throw new Error('此部署尚未配置 Trailblazer 登录')
    this.invalidate(); const generation = this.generation
    this.log('info', 'cloud.login.begin', { generation, issuer: safeOrigin(this.config.issuer) })
    this.state = { phase: 'authorizing', persistent: this.credentials.persistent }
    try {
      const listener = await this.launcher.launch(async (url) => { await this.completeLogin(url, generation) }, () => { if (generation === this.generation) void this.cancelLogin() })
      this.log('info', 'cloud.login.listener-ready', { generation, redirectUri: safeRedirectUri(listener.redirectUri) })
      if (generation !== this.generation) { listener.close(); return this.getState() }
      this.closeListener = () => listener.close()
      const authorization = await this.oidc.authorize(listener.redirectUri)
      this.log('info', 'cloud.login.authorization-ready', { generation, authorizationEndpoint: safeEndpoint(authorization.url) })
      if (generation !== this.generation) { listener.close(); return this.getState() }
      this.transaction = authorization.transaction
      await listener.open(authorization.url)
      this.log('info', 'cloud.login.browser-opened', { generation })
    } catch (error) {
      this.invalidate()
      this.state = { phase: 'signed-out', persistent: this.credentials.persistent, error: cloudFailureMessage(error, '账户中心授权服务不可用，请检查 Platform 的 OIDC 配置或网络连接') }
      this.log('error', 'cloud.login.begin-failed', { generation, error: safeError(error) })
    }
    return this.getState()
  }
  async beginWebLogin(): Promise<string> {
    await this.ready
    if (!this.oidc || !this.config?.redirectUri) throw new Error('此部署尚未配置 Trailblazer 登录')
    this.invalidate()
    this.transactionCookie = randomOperationSuffix()
    const authorization = await this.oidc.authorize(this.config.redirectUri)
    this.transaction = authorization.transaction
    this.state = { phase: 'authorizing', persistent: false }
    return authorization.url
  }
  get webTransactionCookie(): string | undefined { return this.transactionCookie }
  async completeWebLogin(callback: URL, cookie?: string): Promise<void> {
    try {
      if (!this.transactionCookie || cookie !== this.transactionCookie) throw new Error('登录事务 Cookie 无效')
      this.transactionCookie = undefined
      await this.completeLogin(callback, this.generation)
    } catch (error) {
      // A rejected web callback must also be retryable. The desktop loopback
      // path has the same invariant through completeLogin's error boundary.
      if (this.state.phase === 'authorizing') this.state = { ...this.state, phase: 'signed-out', error: cloudFailureMessage(error, '授权未完成，请重新登录') }
      this.transactionCookie = undefined
      throw error
    }
  }
  private async completeLogin(callback: URL, generation: number): Promise<void> {
    const transaction = this.transaction
    const callbackState = callback.searchParams.get('state')
    this.log('info', 'cloud.login.callback-received', {
      generation,
      callbackOrigin: safeOrigin(callback.href),
      callbackPath: callback.pathname,
      hasCode: callback.searchParams.has('code'),
      hasError: callback.searchParams.has('error'),
      hasState: callback.searchParams.has('state'),
      stateLength: callbackState?.length ?? 0,
      stateHash: fingerprint(callbackState)
    })
    try {
      // Keep all callback validation inside the same error boundary as token
      // exchange. A malformed or stale callback must leave the UI in a
      // retryable signed-out state instead of getting stuck on authorizing.
      if (!transaction || !this.oidc || generation !== this.generation) throw new Error('登录事务已取消')
      if (callbackState !== transaction.state) {
        this.log('warn', 'cloud.login.callback-state-mismatch', {
          generation,
          hasState: callback.searchParams.has('state'),
          expectedStateLength: transaction.state.length,
          expectedStateHash: fingerprint(transaction.state),
          callbackStateLength: callbackState?.length ?? 0,
          callbackStateHash: fingerprint(callbackState)
        })
        throw new Error('登录回调不匹配')
      }
      this.transaction = undefined; this.closeListener?.(); this.closeListener = undefined
      const tokens = await this.oidc.complete(transaction, callback)
      if (generation !== this.generation) return
      this.log('info', 'cloud.login.token-exchange-succeeded', { generation, hasRefreshToken: Boolean(tokens.refreshToken) })
      this.tokens = tokens; await this.persist()
      this.state = { phase: 'provisioning', identity: tokens.identity, persistent: this.credentials.persistent }
      await this.retryOnboardingInternal()
      this.log('info', 'cloud.login.onboarding-succeeded', { generation })
    } catch (error) {
      if (generation === this.generation) {
        this.transaction = undefined
        this.closeListener?.(); this.closeListener = undefined
        this.state = { ...this.state, phase: this.tokens ? 'provisioning' : 'signed-out', error: cloudFailureMessage(error, this.tokens ? '账户连接未完成，请重试' : '授权未完成，请重新登录') }
      }
      this.log('error', 'cloud.login.callback-failed', { generation, error: safeError(error) })
      throw error
    }
  }
  private invalidate(): void {
    this.generation++; this.closeListener?.(); this.closeListener = undefined; this.transaction = undefined; this.transactionCookie = undefined; this.refreshFlight = undefined
    for (const controller of this.runControllers) controller.abort(); this.runControllers.clear()
    this.tokens = undefined; this.summary = undefined; this.models = undefined
  }
  async cancelLogin(): Promise<CloudAccountState> { await this.ready; this.invalidate(); await this.credentials.clear(); this.state = { phase: this.config ? 'signed-out' : 'unconfigured', persistent: this.credentials.persistent }; return this.getState() }
  async logout(): Promise<CloudAccountState> {
    await this.ready; const token = this.tokens?.refreshToken || this.tokens?.accessToken
    this.invalidate(); await this.credentials.clear(); this.state = { phase: this.config ? 'signed-out' : 'unconfigured', persistent: this.credentials.persistent }
    if (token) await this.oidc?.revoke(token).catch(() => undefined)
    return this.getState()
  }
  private async persist(): Promise<void> { if (this.tokens?.refreshToken) await this.credentials.write({ refreshToken: this.tokens.refreshToken, identity: this.tokens.identity }) }
  private async accessToken(expectedGeneration = this.generation, subject = this.tokens?.identity.subject): Promise<string> {
    if (!this.tokens || !this.oidc || expectedGeneration !== this.generation || this.tokens.identity.subject !== subject) throw new Error('当前运行的账号已退出或更换，请重新开始')
    if (this.tokens.expiresAt > Date.now() + 30_000) return this.tokens.accessToken
    if (this.refreshFlight) return this.refreshFlight
    const previous = this.tokens
    this.refreshFlight = (async () => {
      try {
        if (!previous.refreshToken) throw new Error('登录已到期，请重新登录')
        const tokens = await this.oidc!.refresh(previous.refreshToken, previous.identity)
        if (expectedGeneration !== this.generation) throw new Error('账号已更换')
        this.tokens = tokens; await this.persist(); return tokens.accessToken
      } catch { if (expectedGeneration === this.generation) { this.invalidate(); this.state = { phase: 'signed-out', persistent: this.credentials.persistent, error: '登录已失效，请重新登录' }; await this.credentials.clear() } throw new Error('登录已失效，请重新登录') }
      finally { if (expectedGeneration === this.generation) this.refreshFlight = undefined }
    })()
    return this.refreshFlight
  }
  private async request<T>(path: string, method = 'GET', body?: unknown, operationId?: string): Promise<T> {
    const generation = this.generation
    const token = await this.accessToken()
    const response = await this.fetcher(`${this.config!.resourceBaseUrl.replace(/\/$/, '')}${PREFIX}${path}`, { method, redirect: 'error', headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(operationId ? { 'Idempotency-Key': operationId } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) })
    if (generation !== this.generation) throw new Error('账号已更换')
    const envelope = await response.json() as Envelope<T>
    if (!response.ok || envelope.code !== 0) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : `账户服务请求失败（${response.status}）`)
    return envelope.data
  }
  private async retryOnboardingInternal(): Promise<CloudAccountSummary> {
    const generation = this.generation
    const data = account(await this.request<CloudAccountSummary>('/onboard', 'POST', {}, this.onboardingId))
    if (generation !== this.generation) throw new Error('账号已更换')
    this.summary = data; this.state = { phase: 'signed-in', identity: this.tokens!.identity, persistent: this.credentials.persistent }
    return data
  }
  private log(level: 'info' | 'warn' | 'error', event: string, details?: Record<string, unknown>): void {
    const writer = this.logger?.[level]
    if (!writer) return
    void Promise.resolve(writer.call(this.logger, event, details)).catch(() => undefined)
  }
  async retryOnboarding(): Promise<CloudAccountSummary> { await this.ready; return this.retryOnboardingInternal() }
  async getAccount(): Promise<CloudAccountSummary> {
    await this.ready
    const next = account(await this.request<CloudAccountSummary>('/account'))
    if (this.summary?.connection.configurationVersion !== next.connection.configurationVersion || this.summary?.connection.group?.id !== next.connection.group?.id) this.models = undefined
    this.summary = next
    return next
  }
  async getUsage(page = 1): Promise<CloudUsage> { await this.ready; return resourceUsage(await this.request(`/usage?page=${Math.max(1, Math.floor(page))}&page_size=20`)) }
  async getChannels(): Promise<CloudChannel[]> { return this.getGroups() }
  async getGroups(): Promise<CloudChannel[]> { await this.ready; return resourceGroups(await this.request('/groups')) }
  async getSupplierLobby() { await this.ready; return resourceLobby(await this.request('/groups/lobby')) }
  async redeem(input: { code: string; operationId: string }): Promise<CloudRedeem> { validateCloudWrite(input); await this.ready; return resourceRedeem(await this.request('/redeem', 'POST', { code: input.code }, input.operationId)) }
  async getRedeemHistory(): Promise<CloudRedeem[]> { await this.ready; return resourceRedeems(await this.request('/redeem/history')) }
  async selectGroup(input: { groupId: string; expectedCredentialVersion: number; operationId: string }): Promise<CloudConnection> { validateCloudWrite(input); await this.ready; const result = connection(await this.request<CloudConnection>('/connection/group', 'PUT', { groupId: input.groupId, expectedCredentialVersion: input.expectedCredentialVersion }, input.operationId)); if (this.summary) this.summary.connection = result; this.models = undefined; return result }
  async rotateConnection(input: { expectedCredentialVersion: number; operationId: string }): Promise<CloudConnection> { validateCloudWrite(input); await this.ready; const result = connection(await this.request<CloudConnection>('/connection/rotate', 'POST', { expectedCredentialVersion: input.expectedCredentialVersion }, input.operationId)); if (this.summary) this.summary.connection = result; return result }
  async modelBinding(): Promise<ManagedModelBinding> { await this.ready; if (this.state.phase !== 'signed-in' || !this.tokens || !this.summary) throw new Error('请先完成 Trailblazer 登录'); return { kind: 'trailblazer-session', subject: this.tokens.identity.subject, generation: this.generation, configurationVersion: this.summary.connection.configurationVersion } }
  managedBaseUrl(protocol: Protocol = 'openai'): string { return `${this.config!.resourceBaseUrl.replace(/\/$/, '')}${PREFIX}/gateway/${protocol === 'gemini' ? 'v1beta/models' : 'v1'}` }
  modelFetch(binding: ManagedModelBinding, fallback: typeof fetch = this.fetcher): typeof fetch {
    return async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const base = new URL(`${this.config!.resourceBaseUrl.replace(/\/$/, '')}${PREFIX}/gateway/`)
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('托管模型请求地址不受信任')
      const route = url.pathname.slice(base.pathname.length)
      if (!/^(?:v1\/(?:models|chat\/completions|responses|messages)|v1beta\/models(?:\/[^/]+(?::(?:streamGenerateContent|generateContent))?)?)$/.test(route)) throw new Error('托管模型请求地址无效')
      const controller = new AbortController(); this.runControllers.add(controller)
      const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
      const headers = new Headers(init?.headers); headers.delete('x-api-key'); headers.delete('x-goog-api-key'); headers.set('authorization', `Bearer ${await this.accessToken(binding.generation, binding.subject)}`); headers.set('X-StoryFabric-Connection-Version', String(binding.configurationVersion)); url.searchParams.delete('key')
      try {
        const response = await this.fetcher(url, { ...init, headers, signal, redirect: 'error' })
        if (response.status === 409) throw new Error('云端连接已更换，请重新开始本次运行')
        return response
      } finally { this.runControllers.delete(controller) }
    }
  }
  adapter(protocol: Protocol, binding: ManagedModelBinding): LlmAdapter { return getAdapter(protocol, this.managedBaseUrl(protocol), { fetcher: this.modelFetch(binding) }) }
  async fetchModels(protocol: Protocol = 'openai'): Promise<string[]> {
    const binding = await this.modelBinding()
    const models = await fetchProviderModels(protocol, this.managedBaseUrl(protocol), '', { fetcher: this.modelFetch(binding) })
    if (binding.generation !== this.generation || binding.subject !== this.tokens?.identity.subject || binding.configurationVersion !== this.summary?.connection.configurationVersion) throw new Error('托管连接已更换，请重新获取模型')
    this.models = models
    return [...models]
  }
  private preferenceScope(): string | undefined {
    if (!this.config || !this.tokens || !this.summary || this.state.phase !== 'signed-in') return undefined
    return createHash('sha256').update(JSON.stringify([this.config.issuer, this.config.resourceBaseUrl, this.tokens.identity.subject, this.summary.connection.group?.id ?? null])).digest('hex')
  }
  async scopeModelPreferences(preferences: ManagedProviderPreferences): Promise<ManagedProviderPreferences> {
    await this.ready
    const modelScope = this.preferenceScope()
    return { models: [...preferences.models], modelSettings: preferences.modelSettings, ...(modelScope ? { modelScope } : {}) }
  }
  async publicProvider(preferences: ManagedProviderPreferences = { models: [], modelSettings: {} }): Promise<ProviderPublic | undefined> {
    await this.ready
    if (!this.config) return undefined
    const active = this.state.phase === 'signed-in'
    const ownsPreferences = active && preferences.modelScope === this.preferenceScope() && preferences.modelScope !== undefined
    const fetched = ownsPreferences ? [...preferences.models] : active ? [...(this.models ?? await this.fetchModels().catch(() => []))] : [...preferences.models]
    return {
      id: TRAILBLAZER_PROVIDER_ID,
      name: 'Trailblazer 云端',
      protocol: 'openai',
      baseUrl: this.managedBaseUrl(),
      authentication: 'trailblazer-session',
      hasKey: false,
      keyStorage: 'none',
      models: fetched,
      modelSettings: preferences.modelSettings,
      managed: 'trailblazer',
      active
    }
  }
  async agentProvider(preferences: ManagedProviderPreferences = { models: [], modelSettings: {} }): Promise<import('../agent/agentLoop').AgentSettings['providers'][number] | undefined> {
    await this.ready; if (this.state.phase !== 'signed-in') return undefined
    const binding = await this.modelBinding()
    return { id: TRAILBLAZER_PROVIDER_ID, name: 'Trailblazer 云端', protocol: 'openai', baseUrl: this.managedBaseUrl(), apiKey: '', authentication: 'trailblazer-session', modelSettings: preferences.modelSettings, adapter: this.adapter('openai', binding), fetcher: this.modelFetch(binding) }
  }
}
function randomOperationSuffix(): string { return randomBytes(18).toString('hex') }

function safeOrigin(value: string): string {
  try { return new URL(value).origin } catch { return '[invalid-url]' }
}

function safeRedirectUri(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch { return '[invalid-url]' }
}

function safeEndpoint(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch { return '[invalid-url]' }
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/([?&](?:code|state|id_token|access_token|refresh_token)=)[^&\s]+/gi, '$1[hidden]').replace(/\s+/g, ' ').slice(0, 240)
}

function fingerprint(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function cloudFailureMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message.trim() : ''
  if (!raw) return fallback
  // Do not expose authorization codes, state, tokens, or long response bodies.
  const sanitized = raw
    .replace(/([?&](?:code|state|id_token|access_token|refresh_token)=)[^&\s]+/gi, '$1[已隐藏]')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
  return sanitized || fallback
}
