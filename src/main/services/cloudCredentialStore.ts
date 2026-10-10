import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CloudCredential, CloudCredentialStore } from '../../core/cloud/cloudCredential'
export type { CloudCredential, CloudCredentialStore } from '../../core/cloud/cloudCredential'
export interface CloudSafeStorage { isEncryptionAvailable(): boolean; getSelectedStorageBackend?(): string; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
export class EncryptedCloudCredentialStore implements CloudCredentialStore {
  constructor(private filePath: string, private storage: CloudSafeStorage) {}
  get persistent(): boolean { return this.storage.isEncryptionAvailable() && this.storage.getSelectedStorageBackend?.() !== 'basic_text' }
  async read(): Promise<CloudCredential | null> {
    if (!this.persistent) { await this.clear(); return null }
    try {
      const value = JSON.parse(this.storage.decryptString(await fs.readFile(this.filePath))) as CloudCredential
      if (!value.refreshToken || typeof value.identity?.subject !== 'string') throw new Error('invalid credential')
      return value
    } catch { await this.clear(); return null }
  }
  async write(value: CloudCredential): Promise<void> {
    if (!this.persistent) { await this.clear(); return }
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, this.storage.encryptString(JSON.stringify(value)), { mode: 0o600 }); await fs.rename(temporary, this.filePath) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  async clear(): Promise<void> { await fs.rm(this.filePath, { force: true }) }
}
