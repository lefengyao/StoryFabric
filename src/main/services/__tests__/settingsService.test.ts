import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SettingsService } from '../settingsService'

async function withService(run: (service: SettingsService) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sf-settings-'))
  try {
    await run(new SettingsService(join(dir, 'settings.json')))
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
})
