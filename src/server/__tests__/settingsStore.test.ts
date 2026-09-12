import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerSettingsStore } from '../settingsStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('server settings store', () => {
  it('normalizes malformed provider fields before public settings consumers use them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-provider-normalize-'))
    roots.push(root)
    const path = join(root, 'settings.json')
    const validProvider = {
      id: 'provider-valid',
      name: '合法供应商',
      protocol: 'openai',
      baseUrl: 'https://valid.example/v1',
      apiKey: '',
      models: ['gpt-4o'],
      modelSettings: { 'gpt-4o': { reasoning: 'high' } }
    }
    await writeFile(path, JSON.stringify({
      providers: [
        validProvider,
        { id: 'provider-normalized', name: '可归一化', protocol: 'anthropic', baseUrl: 'https://normalized.example', apiKey: 42, models: ['claude-3', 99], modelSettings: [] },
        { id: 'missing-core-fields' },
        { id: 'bad-name', name: 42, protocol: 'openai', baseUrl: 'https://example.test', models: [], modelSettings: {} },
        { id: 'bad-protocol', name: '错误协议', protocol: 'invalid', baseUrl: 'https://example.test', models: [], modelSettings: {} },
        { id: 'bad-base-url', name: '错误地址', protocol: 'openai', baseUrl: 42, models: [], modelSettings: {} },
        { id: 'bad-fields', name: '补默认值', protocol: 'openai', baseUrl: 'https://defaults.example', models: 'not-an-array', modelSettings: [] },
        null,
        'invalid'
      ]
    }))

    await expect(new ServerSettingsStore(path).load()).resolves.toMatchObject({
      providers: [
        { id: validProvider.id, name: validProvider.name, protocol: validProvider.protocol, baseUrl: validProvider.baseUrl, hasKey: false, keyPreview: '', models: validProvider.models, modelSettings: validProvider.modelSettings },
        { id: 'provider-normalized', name: '可归一化', protocol: 'anthropic', baseUrl: 'https://normalized.example', hasKey: false, keyPreview: '', models: ['claude-3'], modelSettings: {} },
        { id: 'bad-fields', name: '补默认值', protocol: 'openai', baseUrl: 'https://defaults.example', hasKey: false, keyPreview: '', models: [], modelSettings: {} }
      ]
    })
  })

  it('normalizes malformed recent workspace fields without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-normalize-'))
    roots.push(root)
    const path = join(root, 'settings.json')

    for (const recentWorkspaceOpenedAt of [null, [], 'invalid', 42]) {
      await writeFile(path, JSON.stringify({
        recentWorkspaces: ['valid-workspace', 42, null, { path: 'not-a-string' }],
        recentWorkspaceOpenedAt
      }))

      await expect(new ServerSettingsStore(path).load()).resolves.toMatchObject({
        recentWorkspaces: ['valid-workspace'],
        recentWorkspaceOpenedAt: {}
      })
    }

    await writeFile(path, JSON.stringify({ recentWorkspaces: { path: 'not-an-array' }, recentWorkspaceOpenedAt: {} }))
    await expect(new ServerSettingsStore(path).load()).resolves.toMatchObject({
      recentWorkspaces: [],
      recentWorkspaceOpenedAt: {}
    })
  })

  it('does not overwrite an existing settings file when recent recording cannot parse it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-corrupt-'))
    roots.push(root)
    const path = join(root, 'settings.json')
    const original = '{"providers": [}'
    await writeFile(path, original)

    await expect(new ServerSettingsStore(path).recordRecentWorkspace('workspace-new')).rejects.toThrow()
    await expect(readFile(path, 'utf8')).resolves.toBe(original)
  })

  it('rejects settings updates without overwriting a corrupt settings file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-corrupt-update-'))
    roots.push(root)
    const path = join(root, 'settings.json')
    const original = '{"providers": [}'
    await writeFile(path, original)

    await expect(new ServerSettingsStore(path).update({ theme: 'dark' })).rejects.toThrow()
    await expect(readFile(path, 'utf8')).resolves.toBe(original)
  })

  it('defaults recent workspace timestamps when loading legacy settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-legacy-'))
    roots.push(root)
    const path = join(root, 'settings.json')
    await writeFile(path, JSON.stringify({ recentWorkspaces: ['legacy-workspace'] }))

    await expect(new ServerSettingsStore(path).load()).resolves.toMatchObject({
      recentWorkspaces: ['legacy-workspace'],
      recentWorkspaceOpenedAt: {}
    })
  })

  it('serializes recent workspace records without losing concurrent updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-recent-'))
    roots.push(root)
    const store = new ServerSettingsStore(join(root, 'settings.json'))

    await Promise.all(['workspace-a', 'workspace-b', 'workspace-c'].map((path) => store.recordRecentWorkspace(path)))

    const settings = await store.load()
    expect(new Set(settings.recentWorkspaces)).toEqual(new Set(['workspace-a', 'workspace-b', 'workspace-c']))
    expect(Object.keys(settings.recentWorkspaceOpenedAt)).toEqual(expect.arrayContaining(['workspace-a', 'workspace-b', 'workspace-c']))
  })

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

  it('rejects mutations with the wrong secret without rewriting encrypted provider keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-wrong-secret-'))
    roots.push(root)
    const path = join(root, 'settings.json')
    const writer = new ServerSettingsStore(path, 'key-a')
    await writer.saveProvider({ name: '加密供应商', protocol: 'openai', baseUrl: 'https://example.test', models: [], apiKey: 'sk-preserve-me' })

    const original = await readFile(path, 'utf8')
    await expect(new ServerSettingsStore(path, 'key-b').recordRecentWorkspace('workspace-new')).rejects.toThrow()
    await expect(readFile(path, 'utf8')).resolves.toBe(original)
  })

  it('fetchModels with a saved provider ignores caller protocol and base URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyfabric-settings-fetch-'))
    roots.push(root)
    const store = new ServerSettingsStore(join(root, 'settings.json'), 'server-access-key')
    await store.saveProvider({ name: '已保存', protocol: 'gemini', baseUrl: 'https://saved.example/v1beta', models: [], apiKey: 'sk-saved' })
    const id = (await store.load()).providers[0].id

    await expect(store.providerInput({
      providerId: id,
      protocol: 'openai',
      baseUrl: 'https://attacker.example/v1',
      apiKey: 'sk-attacker'
    })).resolves.toEqual({ protocol: 'gemini', baseUrl: 'https://saved.example/v1beta', apiKey: 'sk-attacker' })
  })
})
