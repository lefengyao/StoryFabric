import { registerPlugin } from '@capacitor/core'
import type { CloudAccountApi, CloudAccountState, CloudAccountSummary, CloudChannel, CloudRedeem, CloudSupplierGroup, CloudUsage } from '../../../shared/cloudAccount'

interface NativeArrayResult<T> { items: T[] }
interface NativeAccountPlugin {
  getState(): Promise<CloudAccountState>
  beginLogin(): Promise<CloudAccountState>
  cancelLogin(): Promise<CloudAccountState>
  logout(): Promise<CloudAccountState>
  retryOnboarding(): Promise<CloudAccountSummary>
  getAccount(): Promise<CloudAccountSummary>
  getUsage(options: { page: number }): Promise<CloudUsage>
  getChannels(): Promise<NativeArrayResult<CloudChannel>>
  getGroups(): Promise<NativeArrayResult<CloudChannel>>
  getSupplierLobby(): Promise<NativeArrayResult<CloudSupplierGroup>>
  redeem(input: { code: string; operationId: string }): Promise<CloudRedeem>
  getRedeemHistory(): Promise<NativeArrayResult<CloudRedeem>>
  selectGroup(input: { groupId: string; expectedCredentialVersion: number; operationId: string }): Promise<import('../../../shared/cloudAccount').CloudConnection>
  rotateConnection(input: { expectedCredentialVersion: number; operationId: string }): Promise<import('../../../shared/cloudAccount').CloudConnection>
  getPreferenceScope(): Promise<{ scope?: string | null }>
  getModels(input: { protocol: 'openai' | 'anthropic' | 'gemini' }): Promise<{ models: string[] }>
  addListener(eventName: string, listener: (event: Record<string, unknown>) => void): Promise<{ remove(): Promise<void> }>
  startModelRequest(input: { requestId: string; url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string> }>
  abortModelRequest(input: { requestId: string }): Promise<void>
}

export const trailblazerNative = registerPlugin<NativeAccountPlugin>('TrailblazerAccount')

/** Mirrors the desktop account contract; access and refresh tokens never cross this native bridge. */
export const androidCloudAccount: CloudAccountApi & {
  getPreferenceScope(): Promise<string | undefined>
  getModels(protocol?: 'openai' | 'anthropic' | 'gemini'): Promise<string[]>
} = {
  getState: () => trailblazerNative.getState(),
  beginLogin: () => trailblazerNative.beginLogin(),
  cancelLogin: () => trailblazerNative.cancelLogin(),
  logout: () => trailblazerNative.logout(),
  retryOnboarding: () => trailblazerNative.retryOnboarding(),
  getAccount: () => trailblazerNative.getAccount(),
  getUsage: (page = 1) => trailblazerNative.getUsage({ page }),
  getChannels: async () => (await trailblazerNative.getChannels()).items,
  getGroups: async () => (await trailblazerNative.getGroups()).items,
  getSupplierLobby: async () => (await trailblazerNative.getSupplierLobby()).items,
  redeem: (input) => trailblazerNative.redeem(input),
  getRedeemHistory: async () => (await trailblazerNative.getRedeemHistory()).items,
  selectGroup: (input) => trailblazerNative.selectGroup(input),
  rotateConnection: (input) => trailblazerNative.rotateConnection(input),
  getPreferenceScope: async () => (await trailblazerNative.getPreferenceScope()).scope || undefined,
  getModels: async (protocol = 'openai') => (await trailblazerNative.getModels({ protocol })).models
}
