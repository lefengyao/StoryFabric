import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FetchModelsInput, SettingsPatch } from '../shared/api'
import type { AppSettings, ProviderInput, ProviderPublic, ProviderStored, PublicAppSettings } from '../shared/types'

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
  showSessionLength: false
}

function keyPreview(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return `${key.slice(0, 2)}****`
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

export class ServerSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async loadRaw(): Promise<ServerSettings> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<ServerSettings>
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        providers: Array.isArray(parsed.providers) ? parsed.providers.filter((item): item is ServerProvider => Boolean(item && typeof item.id === 'string')) : []
      }
    } catch {
      return { ...DEFAULT_SETTINGS, providers: [] }
    }
  }

  private async saveRaw(settings: ServerSettings): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })
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
      keyPreview: keyPreview(provider.apiKey)
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
          apiKey: input.apiKey ?? old.apiKey
        }
      } else {
        providers.push({
          id: `prov_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: input.name.trim(),
          protocol: input.protocol,
          baseUrl: input.baseUrl.trim(),
          models: input.models,
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

  async agentSettings(): Promise<{ providers: Array<{ id: string; protocol: 'openai' | 'anthropic' | 'gemini'; baseUrl: string; apiKey: string; name?: string }>; customPrompt?: string }> {
    const settings = await this.loadRaw()
    return {
      customPrompt: settings.customPrompt,
      providers: settings.providers.map(({ id, protocol, baseUrl, apiKey, name }) => ({ id, protocol, baseUrl, apiKey, name }))
    }
  }

  async apiKeyOf(providerId: string): Promise<string> {
    const settings = await this.loadRaw()
    return settings.providers.find((provider) => provider.id === providerId)?.apiKey ?? ''
  }

  async providerInput(input: FetchModelsInput): Promise<{ protocol: FetchModelsInput['protocol']; baseUrl: string; apiKey: string }> {
    const apiKey = input.apiKey ?? (input.providerId ? await this.apiKeyOf(input.providerId) : '')
    return { protocol: input.protocol, baseUrl: input.baseUrl, apiKey }
  }

  private async persist(settings: ServerSettings): Promise<ServerSettings> {
    await this.saveRaw(settings)
    return settings
  }
}
