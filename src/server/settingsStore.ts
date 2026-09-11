import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import type { FetchModelsInput, SettingsPatch } from '../shared/api'
import type { AppSettings, ModelSettings, ProviderInput, ProviderPublic, ProviderStored, PublicAppSettings } from '../shared/types'
import { pruneModelSettings } from '../core/llm/modelCatalog'
import { keyPreview } from '../shared/keyPreview'

interface ServerProvider extends Omit<ProviderStored, 'apiKeyEncrypted'> {
  apiKey: string
}

interface ServerSettings extends Omit<AppSettings, 'providers'> {
  providers: ServerProvider[]
}

const DEFAULT_SETTINGS: ServerSettings = {
  providers: [],
  theme: 'system',
  recentWorkspaces: [],
  customPrompt: '',
  showSessionLength: false,
  completionSound: false,
  accentColorLight: '#6366f1',
  accentColorDark: '#818cf8',
  editorFontSize: 14,
  editorLineHeight: 1.75,
  editorFontFamily: 'sans',
  autosaveSeconds: 0,
  sendShortcut: 'enter',
  chatDensity: 'comfortable'
}

export class ServerSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly encryptionKey: Buffer

  constructor(private readonly filePath: string, secret = filePath) {
    this.encryptionKey = createHash('sha256').update(secret, 'utf8').digest()
  }

  private encryptKey(value: string): string {
    if (!value) return ''
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
  }

  private decryptKey(value: string): string {
    if (!value) return ''
    if (!value.startsWith('enc:v1:')) return value
    try {
      const [, , ivText, tagText, dataText] = value.split(':')
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(ivText, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      return ''
    }
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async loadRaw(): Promise<ServerSettings> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<ServerSettings>
      const providers = Array.isArray(parsed.providers) ? parsed.providers.filter((item): item is ServerProvider => Boolean(item && typeof item.id === 'string')).map((item) => ({ ...item, apiKey: this.decryptKey(typeof item.apiKey === 'string' ? item.apiKey : '') })) : []
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        providers
      }
    } catch {
      return { ...DEFAULT_SETTINGS, providers: [] }
    }
  }

  private async saveRaw(settings: ServerSettings): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const persisted = { ...settings, providers: settings.providers.map((provider) => ({ ...provider, apiKey: this.encryptKey(provider.apiKey) })) }
      await fs.writeFile(temp, JSON.stringify(persisted, null, 2), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temp, this.filePath)
      await fs.chmod(this.filePath, 0o600).catch(() => undefined)
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined)
    }
  }

  private toPublic(settings: ServerSettings): PublicAppSettings {
    const providers: ProviderPublic[] = settings.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      models: provider.models,
      hasKey: Boolean(provider.apiKey),
      keyPreview: keyPreview(provider.apiKey),
      modelSettings: provider.modelSettings ?? {}
    }))
    return { ...settings, providers }
  }

  load(): Promise<PublicAppSettings> {
    return this.serialized(async () => this.toPublic(await this.loadRaw()))
  }

  update(patch: SettingsPatch): Promise<PublicAppSettings> {
    return this.serialized(async () => {
      const next = { ...(await this.loadRaw()), ...patch }
      return this.toPublic(await this.persist(next))
    })
  }

  saveProvider(input: ProviderInput): Promise<PublicAppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const providers = [...settings.providers]
      const index = input.id ? providers.findIndex((provider) => provider.id === input.id) : -1
      if (index >= 0) {
        const old = providers[index]
        providers[index] = {
          ...old,
          name: input.name.trim(),
          protocol: input.protocol,
          baseUrl: input.baseUrl.trim(),
          models: input.models,
          modelSettings: pruneModelSettings(input.models, input.modelSettings ?? old.modelSettings),
          apiKey: input.apiKey ?? old.apiKey
        }
      } else {
        providers.push({
          id: `prov_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: input.name.trim(),
          protocol: input.protocol,
          baseUrl: input.baseUrl.trim(),
          models: input.models,
          modelSettings: pruneModelSettings(input.models, input.modelSettings),
          apiKey: input.apiKey ?? ''
        })
      }
      return this.toPublic(await this.persist({ ...settings, providers }))
    })
  }

  deleteProvider(id: string): Promise<PublicAppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const next = {
        ...settings,
        providers: settings.providers.filter((provider) => provider.id !== id),
        defaultChatModel: settings.defaultChatModel?.providerId === id ? undefined : settings.defaultChatModel,
        quickActionModel: settings.quickActionModel?.providerId === id ? undefined : settings.quickActionModel
      }
      return this.toPublic(await this.persist(next))
    })
  }

  async agentSettings(): Promise<{ providers: Array<{ id: string; protocol: 'openai' | 'anthropic' | 'gemini'; baseUrl: string; apiKey: string; name?: string; modelSettings?: Record<string, ModelSettings> }>; customPrompt?: string }> {
    const settings = await this.loadRaw()
    return {
      customPrompt: settings.customPrompt,
      providers: settings.providers.map(({ id, protocol, baseUrl, apiKey, name, modelSettings }) => ({ id, protocol, baseUrl, apiKey, name, modelSettings }))
    }
  }

  async apiKeyOf(providerId: string): Promise<string> {
    const settings = await this.loadRaw()
    return settings.providers.find((provider) => provider.id === providerId)?.apiKey ?? ''
  }

  async providerInput(input: FetchModelsInput): Promise<{ protocol: FetchModelsInput['protocol']; baseUrl: string; apiKey: string }> {
    if (!input.providerId) return { protocol: input.protocol, baseUrl: input.baseUrl, apiKey: input.apiKey ?? '' }
    const settings = await this.loadRaw()
    const provider = settings.providers.find((item) => item.id === input.providerId)
    if (!provider) throw new Error('供应商不存在')
    return {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: input.apiKey ?? provider.apiKey
    }
  }

  private async persist(settings: ServerSettings): Promise<ServerSettings> {
    await this.saveRaw(settings)
    return settings
  }
}
