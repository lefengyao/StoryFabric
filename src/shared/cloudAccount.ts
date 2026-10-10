/** Public account boundary. No bearer token, API key, or OAuth code crosses it. */
export const TRAILBLAZER_PROVIDER_ID = 'trailblazer-managed'
export const TRAILBLAZER_RESOURCE = 'urn:trailblazer:sub2api:storyfabric'
// Keep the requested permissions aligned with the scopes registered by
// T-user-platform and enforced by the Sub2API StoryFabric routes.
export const TRAILBLAZER_SCOPES = 'openid profile email offline_access storyfabric:account:read storyfabric:connection:provision storyfabric:usage:read storyfabric:channels:read storyfabric:channel:write storyfabric:redeem storyfabric:credential:rotate storyfabric:models:invoke'
export type CloudAccountPhase = 'unconfigured' | 'signed-out' | 'authorizing' | 'provisioning' | 'signed-in'
export interface CloudIdentity { subject: string; name?: string; email?: string }
export interface CloudAccountState { phase: CloudAccountPhase; identity?: CloudIdentity; error?: string; persistent: boolean }
export interface CloudConnection {
  applicationId: string; status: string; credentialVersion: number; configurationVersion: number
  group?: { id: string; name: string } | null
}
export interface CloudAccountSummary {
  businessUserId: string; status: string; balance: { amount: number; currency: string }; connection: CloudConnection
}
export interface CloudChannel { id: string; name: string; platform?: string; description?: string; rate?: number }
export interface CloudSupplierModel { name: string; billingMode: string; inputPrice: number; outputPrice: number; cacheReadPrice?: number; cacheWritePrice?: number }
export interface CloudSupplierGroup extends CloudChannel { models: CloudSupplierModel[] }
export interface CloudUsage { items: Array<{ id: string | number; model: string; totalTokens?: number; cost?: number; createdAt?: string }>; total: number; page: number; pageSize: number }
export interface CloudRedeem { id?: string | number; type?: string; amount?: number; createdAt?: string }
export type CloudAccountConfigSource = 'application' | 'environment' | 'none'
/** Non-sensitive desktop connection configuration. Tokens and client secrets never cross this boundary. */
export interface CloudAccountConfig {
  platformWebUrl: string
  source: CloudAccountConfigSource
}
export interface CloudAccountApi {
  /** Optional until the desktop bridge wires application-level account configuration. */
  getConfig?(): Promise<CloudAccountConfig>
  /** Pass null to clear the application override and fall back to deployment configuration. */
  setPlatformWebUrl?(url: string | null): Promise<CloudAccountConfig>
  getState(): Promise<CloudAccountState>
  beginLogin(): Promise<CloudAccountState>
  cancelLogin(): Promise<CloudAccountState>
  logout(): Promise<CloudAccountState>
  retryOnboarding(): Promise<CloudAccountSummary>
  getAccount(): Promise<CloudAccountSummary>
  getUsage(page?: number): Promise<CloudUsage>
  getChannels(): Promise<CloudChannel[]>
  getGroups(): Promise<CloudChannel[]>
  /** Optional for older bridges that only provide the group list. */
  getSupplierLobby?(): Promise<CloudSupplierGroup[]>
  redeem(input: { code: string; operationId: string }): Promise<CloudRedeem>
  getRedeemHistory(): Promise<CloudRedeem[]>
  selectGroup(input: { groupId: string; expectedCredentialVersion: number; operationId: string }): Promise<CloudConnection>
  rotateConnection(input: { expectedCredentialVersion: number; operationId: string }): Promise<CloudConnection>
}
export interface ManagedModelBinding { kind: 'trailblazer-session'; subject: string; generation: number; configurationVersion: number }
export function validateCloudWrite(input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('账户请求无效')
  const value = input as Record<string, unknown>
  if (typeof value.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.operationId)) throw new Error('操作编号无效')
  if ('expectedCredentialVersion' in value && (!Number.isSafeInteger(value.expectedCredentialVersion) || Number(value.expectedCredentialVersion) < 1)) throw new Error('连接版本无效')
  if ('code' in value && (typeof value.code !== 'string' || !value.code.trim() || value.code.length > 256)) throw new Error('兑换码无效')
  if ('groupId' in value && (typeof value.groupId !== 'string' || !value.groupId || value.groupId.length > 128)) throw new Error('分组无效')
}
