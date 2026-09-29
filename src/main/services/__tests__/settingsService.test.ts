import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { SettingsService } from '../settingsService'

async function withService(run: (service: SettingsService, file: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sf-settings-'))
  try {
    const file = join(dir, 'settings.json')
    await run(new SettingsService(file), file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const provider = { name: '测试供应商', protocol: 'openai' as const, baseUrl: 'https://api.test/v1', apiKey: 'sk-test', models: ['gpt-4o', 'claude-x'] }

describe('SettingsService 每模型参数', () => {
  it('保存后能读回，并按模型列表清理失效项', async () => {
    await withService(async (service) => {
      await service.saveProvider({
        ...provider,
        modelSettings: { 'gpt-4o': { reasoning: 'high', maxOutputTokens: 4096 }, '已删除的模型': { reasoning: 'low' } }
      })

      const publicSettings = service.toPublic(await service.load())
      expect(publicSettings.providers[0].modelSettings).toEqual({ 'gpt-4o': { reasoning: 'high', maxOutputTokens: 4096 } })
    })
  })

  it('再次保存但未传 modelSettings 时保留旧值', async () => {
    await withService(async (service) => {
      await service.saveProvider({ ...provider, modelSettings: { 'gpt-4o': { reasoning: 'medium' } } })
      const id = service.toPublic(await service.load()).providers[0].id

      await service.saveProvider({ ...provider, id, models: ['gpt-4o'] })

      const publicSettings = service.toPublic(await service.load())
      expect(publicSettings.providers[0].modelSettings).toEqual({ 'gpt-4o': { reasoning: 'medium' } })
    })
  })

  it('能力开关与思考强度映射能原样存回', async () => {
    await withService(async (service) => {
      await service.saveProvider({
        ...provider,
        modelSettings: {
          'gpt-4o': {
            reasoningSupport: true,
            vision: true,
            reasoning: 'high',
            reasoningMap: { path: 'enable_thinking', values: { high: 'true', off: 'false' } },
            contextTokens: 131072,
            maxOutputTokens: 8192
          }
        }
      })

      const publicSettings = service.toPublic(await service.load())
      expect(publicSettings.providers[0].modelSettings['gpt-4o']).toEqual({
        reasoningSupport: true,
        vision: true,
        reasoning: 'high',
        reasoningMap: { path: 'enable_thinking', values: { high: 'true', off: 'false' } },
        contextTokens: 131072,
        maxOutputTokens: 8192
      })
    })
  })

  it('旧设置文件缺少该字段时读回空对象', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-settings-'))
    try {
      // 模拟本功能之前的 settings.json：provider 上没有 modelSettings
      const file = join(dir, 'settings.json')
      await writeFile(
        file,
        JSON.stringify({
          providers: [{ id: 'p1', name: '旧供应商', protocol: 'openai', baseUrl: 'https://x/v1', apiKeyEncrypted: 'plain:', models: ['gpt-4o'] }],
          theme: 'system',
          recentWorkspaces: [],
          customPrompt: '',
          showSessionLength: false
        }),
        'utf-8'
      )

      const publicSettings = new SettingsService(file).toPublic(await new SettingsService(file).load())
      expect(publicSettings.providers[0].modelSettings).toEqual({})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('旧设置文件缺少 recentWorkspaceOpenedAt 时读回空对象', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-settings-'))
    try {
      const file = join(dir, 'settings.json')
      await writeFile(
        file,
        JSON.stringify({
          providers: [],
          theme: 'system',
          recentWorkspaces: ['C:/旧工作区'],
          customPrompt: '',
          showSessionLength: false
        }),
        'utf-8'
      )

      const settings = await new SettingsService(file).load()
      expect(settings.recentWorkspaceOpenedAt).toEqual({})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each([
    { recentWorkspaces: null, recentWorkspaceOpenedAt: null },
    { recentWorkspaces: 'legacy-workspace', recentWorkspaceOpenedAt: [] },
    { recentWorkspaces: { path: 'legacy-workspace' }, recentWorkspaceOpenedAt: 'legacy-time' },
    { recentWorkspaces: [null, 42, { path: 'legacy-workspace' }], recentWorkspaceOpenedAt: { broken: null } }
  ])('异常 recent 字段形状归一化为正确的空类型或合法值 %#', async (malformed) => {
    await withService(async (service, file) => {
      await writeFile(file, JSON.stringify({
        theme: 'dark',
        customPrompt: '保留已有字段',
        completionSound: true,
        ...malformed
      }), 'utf-8')

      const settings = await service.load()

      expect(settings.recentWorkspaces).toEqual([])
      expect(settings.recentWorkspaceOpenedAt).toEqual({})
      expect(settings.theme).toBe('dark')
      expect(settings.customPrompt).toBe('保留已有字段')
      expect(settings.completionSound).toBe(true)
    })
  })

  it('合法 recent 字段和其他已有设置保持不变', async () => {
    await withService(async (service, file) => {
      const recentWorkspaces = ['C:/工作区-a', 'C:/工作区-b']
      const recentWorkspaceOpenedAt = {
        'C:/工作区-a': '2026-09-11T08:30:00.000Z',
        'C:/工作区-b': '2026-09-11T08:31:00.000Z'
      }
      await writeFile(file, JSON.stringify({
        theme: 'dark',
        recentWorkspaces,
        recentWorkspaceOpenedAt,
        customPrompt: '保留已有字段'
      }), 'utf-8')

      await expect(service.load()).resolves.toMatchObject({
        theme: 'dark',
        recentWorkspaces,
        recentWorkspaceOpenedAt,
        customPrompt: '保留已有字段'
      })
    })
  })

  it('更新 recentWorkspaceOpenedAt 后能读回 ISO 时间映射', async () => {
    await withService(async (service) => {
      const openedAt = '2026-09-11T08:30:00.000Z'
      const recentWorkspaceOpenedAt = { 'C:/工作区': openedAt }

      await service.update({ recentWorkspaceOpenedAt })

      expect((await service.load()).recentWorkspaceOpenedAt).toEqual(recentWorkspaceOpenedAt)
    })
  })

  it('并发记录工作区时不丢失任一条记录', async () => {
    await withService(async (service) => {
      const first = 'C:/工作区-a'
      const second = 'C:/工作区-b'

      await Promise.all([
        service.recordRecentWorkspace(first),
        service.recordRecentWorkspace(second)
      ])

      const settings = await service.load()
      expect(settings.recentWorkspaces).toEqual([second, first])
      expect(settings.recentWorkspaceOpenedAt).toEqual({
        [first]: expect.any(String),
        [second]: expect.any(String)
      })
    })
  })

  it('malformed providers are filtered or normalized before settings IPC consumers use them', async () => {
    await withService(async (service, file) => {
      const validProvider = {
        id: 'valid-provider',
        name: '合法供应商',
        protocol: 'openai',
        baseUrl: 'https://valid.example/v1',
        apiKeyEncrypted: 'plain:c2VjcmV0',
        models: ['gpt-4o'],
        modelSettings: { 'gpt-4o': { reasoning: 'high' } }
      }
      await writeFile(file, JSON.stringify({
        providers: [
          null,
          'not-a-provider',
          { id: 'missing-core-fields' },
          { id: 'normalized-provider', name: '可归一化', protocol: 'anthropic', baseUrl: 'https://normalized.example', apiKeyEncrypted: 42, models: ['claude-3', 99], modelSettings: [] },
          validProvider
        ]
      }), 'utf-8')

      const settings = await service.load()

      expect(settings.providers).toEqual([
        {
          id: 'normalized-provider',
          name: '可归一化',
          protocol: 'anthropic',
          baseUrl: 'https://normalized.example',
          apiKeyEncrypted: '',
          models: ['claude-3'],
          modelSettings: {}
        },
        validProvider
      ])
      expect(service.toPublic(settings).providers).toHaveLength(2)
      await expect(service.saveProvider({ ...provider, id: 'valid-provider' })).resolves.toBeTruthy()
      await expect(service.deleteProvider('normalized-provider')).resolves.toBeTruthy()
    })
  })

  it('fetchModels with a saved provider always uses the saved protocol and base URL', async () => {
    await withService(async (service) => {
      await service.saveProvider({ ...provider, protocol: 'gemini', baseUrl: 'https://saved.example/v1beta' })
      const id = service.toPublic(await service.load()).providers[0].id

      await expect(service.providerInput({
        providerId: id,
        protocol: 'openai',
        baseUrl: 'https://attacker.example/v1',
        apiKey: 'attacker-key'
      })).resolves.toEqual({ protocol: 'gemini', baseUrl: 'https://saved.example/v1beta', apiKey: 'attacker-key' })
    })
  })

  it('旧设置文件缺少 chatFontSize 时使用 14px', async () => {
    await withService(async (service, file) => {
      await writeFile(file, JSON.stringify({ providers: [], theme: 'system', recentWorkspaces: [] }), 'utf-8')
      expect((await service.load()).chatFontSize).toBe(14)
    })
  })

  it.each([
    ['过小', 1, 13],
    ['过大', 99, 20],
    ['非数字', '18', 14],
    ['空值', null, 14]
  ])('chatFontSize %s 时回退或夹紧为 %s', async (_label, value, expected) => {
    await withService(async (service, file) => {
      await writeFile(file, JSON.stringify({ chatFontSize: value }), 'utf-8')
      expect((await service.load()).chatFontSize).toBe(expected)
    })
  })

  it('adds generation preferences to legacy settings', async () => {
    await withService(async (service, file) => {
      await writeFile(file, JSON.stringify({ providers: [], customPrompt: 'legacy' }), 'utf-8')

      expect((await service.load()).agentGeneration).toEqual({ agentTemperature: 70, proseAlternativesEnabled: false, maxToolRounds: 100 })
    })
  })

  it('consumes the legacy global prompt once after migrating it to a project', async () => {
    await withService(async (service, file) => {
      await writeFile(file, JSON.stringify({ providers: [], customPrompt: 'legacy project voice' }), 'utf-8')
      const migrate = vi.fn(async () => undefined)

      await expect(service.consumeLegacyCustomPrompt(migrate)).resolves.toBe('legacy project voice')
      await expect(service.consumeLegacyCustomPrompt(migrate)).resolves.toBeUndefined()
      expect(migrate).toHaveBeenCalledOnce()
      expect((await service.load()).customPrompt).toBe('')
    })
  })

  it('persists normalized generation preferences', async () => {
    await withService(async (service) => {
      await service.update({ agentGeneration: { agentTemperature: -1, proseAlternativesEnabled: true, maxToolRounds: 250 } })

      expect((await service.load()).agentGeneration).toEqual({ agentTemperature: 0, proseAlternativesEnabled: true, maxToolRounds: 250 })
    })
  })

  it('returns isolated generation defaults after a malformed settings fallback', async () => {
    await withService(async (service, file) => {
      await writeFile(file, '{', 'utf-8')
      const first = service.toPublic(await service.load())
      try {
        first.agentGeneration.agentTemperature = 0

        expect(service.toPublic(await service.load()).agentGeneration).toEqual({ agentTemperature: 70, proseAlternativesEnabled: false, maxToolRounds: 100 })
      } finally {
        first.agentGeneration.agentTemperature = 70
      }
    })
  })
})
