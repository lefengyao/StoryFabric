import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerSettingsStore } from '../settingsStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('server settings store', () => {
  it('encrypts provider API keys at rest with the configured server secret', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-'))
    roots.push(root)
    const path = join(root, 'settings.json')
    const store = new ServerSettingsStore(path, 'server-access-key')
    await store.saveProvider({ name: '测试供应商', protocol: 'openai', baseUrl: 'https://example.test', models: [], apiKey: 'sk-secret-value' })

    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain('sk-secret-value')
    expect(raw).toContain('enc:v1:')
    await expect(store.apiKeyOf((await store.load()).providers[0].id)).resolves.toBe('sk-secret-value')
    await expect(new ServerSettingsStore(path, 'different-key').apiKeyOf((await store.load()).providers[0].id)).resolves.toBe('')
  })
})
