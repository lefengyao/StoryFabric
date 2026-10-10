import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedCloudCredentialStore } from '../cloudCredentialStore'

function fakeStorage(available = true) {
  return { isEncryptionAvailable: () => available, getSelectedStorageBackend: () => 'keychain', encryptString: (value: string) => Buffer.from(`enc:${Buffer.from(value).toString('base64')}`), decryptString: (value: Buffer) => Buffer.from(value.toString().slice(4), 'base64').toString() }
}
describe('EncryptedCloudCredentialStore', () => {
  it('round trips encrypted refresh credentials without plaintext storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storyfabric-cloud-')); const path = join(dir, 'refresh.enc')
    const store = new EncryptedCloudCredentialStore(path, fakeStorage())
    await store.write({ refreshToken: 'opaque-refresh', identity: { subject: 'subject-1' } })
    expect((await readFile(path)).toString()).toContain('enc:')
    expect((await readFile(path)).toString()).not.toContain('opaque-refresh')
    expect(await store.read()).toEqual({ refreshToken: 'opaque-refresh', identity: { subject: 'subject-1' } })
  })
  it('clears and reports memory only when safe storage is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storyfabric-cloud-')); const path = join(dir, 'refresh.enc')
    const store = new EncryptedCloudCredentialStore(path, fakeStorage(false))
    expect(store.persistent).toBe(false); await store.write({ refreshToken: 'secret', identity: { subject: 'subject-1' } }); expect(await store.read()).toBeNull()
  })
})
