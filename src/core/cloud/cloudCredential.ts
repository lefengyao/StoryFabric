import type { CloudIdentity } from '../../shared/cloudAccount'
export interface CloudCredential { refreshToken: string; identity: CloudIdentity }
export interface CloudCredentialStore { readonly persistent: boolean; read(): Promise<CloudCredential | null>; write(value: CloudCredential): Promise<void>; clear(): Promise<void> }
export class MemoryCloudCredentialStore implements CloudCredentialStore {
  readonly persistent = false
  private value: CloudCredential | null = null
  async read(): Promise<CloudCredential | null> { return this.value }
  async write(value: CloudCredential): Promise<void> { this.value = value }
  async clear(): Promise<void> { this.value = null }
}
