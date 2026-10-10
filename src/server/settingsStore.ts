import { promises as fs } from 'node:fs'
import { normalizeUpdatePreferences } from '../shared/updates'
import { dirname } from 'node:path'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import type { FetchModelsInput, SettingsPatch } from '../shared/api'
import type { AppSettings, ManagedProviderPreferences, ModelSettings, ProviderInput, ProviderPublic, ProviderStored, PublicAppSettings } from '../shared/types'
import { pruneModelSettings } from '../core/llm/modelCatalog'
import { keyPreview } from '../shared/keyPreview'
import { forgetRecentWorkspace, markRecentWorkspace } from '../shared/recentWorkspaces'
import { throwIfWorkspaceRequestAborted } from '../shared/api'
import { DEFAULT_ORCHESTRATION_PREFERENCES, normalizeOrchestrationPreferences } from '../shared/creative'
import { DEFAULT_AGENT_GENERATION_PREFERENCES, normalizeAgentGenerationPreferences, type AgentGenerationPreferences } from '../shared/agentGeneration'

interface ServerProvider extends Omit<ProviderStored, 'apiKeyEncrypted'> {
  apiKey: string
}

interface ServerSettings extends Omit<AppSettings, 'providers' | 'trailblazerProvider'> {
  providers: ServerProvider[]
  trailblazerProvider: ManagedProviderPreferences
}

const DEFAULT_SETTINGS: ServerSettings = {
  updatePreferences: normalizeUpdatePreferences(undefined),
  providers: [],
  trailblazerProvider: { models: [], modelSettings: {} },
  orchestrationDefaults: { ...DEFAULT_ORCHESTRATION_PREFERENCES, enabledStageIds: [...DEFAULT_ORCHESTRATION_PREFERENCES.enabledStageIds], modelByStage: {} },
  agentGeneration: { ...DEFAULT_AGENT_GENERATION_PREFERENCES },
  theme: 'system',
  recentWorkspaces: [],
  recentWorkspaceOpenedAt: {},
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
  chatDensity: 'comfortable',
  chatFontSize: 14
}

function defaultSettings(): ServerSettings {
  return { ...DEFAULT_SETTINGS, providers: [], agentGeneration: normalizeAgentGenerationPreferences({}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeManagedProviderPreferences(value: unknown): ManagedProviderPreferences {
  if (!isRecord(value)) return { models: [], modelSettings: {} }
  const models = Array.isArray(value.models)
    ? [...new Set(value.models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0))]
    : []
  const modelSettings = isRecord(value.modelSettings)
    ? Object.fromEntries(Object.entries(value.modelSettings).filter((entry) => isRecord(entry[1]))) as ManagedProviderPreferences['modelSettings']
    : {}
  const modelScope = typeof value.modelScope === 'string' && /^[a-f0-9]{64}$/.test(value.modelScope) ? value.modelScope : undefined
  return { models, modelSettings: pruneModelSettings(models, modelSettings), ...(modelScope ? { modelScope } : {}) }
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isProviderProtocol(value: unknown): value is ProviderStored['protocol'] {
  return value === 'openai' || value === 'anthropic' || value === 'gemini'
}

function normalizeProvider(value: unknown, decryptKey: (value: string, strict?: boolean) => string): ServerProvider | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.name !== 'string' || !isProviderProtocol(value.protocol) || typeof value.baseUrl !== 'string') return null
  const models = Array.isArray(value.models) ? value.models.filter((model): model is string => typeof model === 'string') : []
  const modelSettings = isRecord(value.modelSettings)
    ? Object.fromEntries(Object.entries(value.modelSettings).filter((entry) => isRecord(entry[1]))) as ServerProvider['modelSettings']
    : {}
  return {
    id: value.id,
    name: value.name,
    protocol: value.protocol,
    baseUrl: value.baseUrl,
    apiKey: decryptKey(typeof value.apiKey === 'string' ? value.apiKey : '', true),
    models,
    modelSettings
  }
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

  private decryptKey(value: string, strict = false): string {
    if (!value) return ''
    if (!value.startsWith('enc:v1:')) return value
    try {
      const [, , ivText, tagText, dataText] = value.split(':')
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(ivText, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      if (strict) throw new Error('设置中的供应商 API key 无法解密')
      return ''
    }
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async loadRawStrict(): Promise<ServerSettings> {
    const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown
    if (!isRecord(parsed)) throw new Error('设置文件格式无效')

    const providers = Array.isArray(parsed.providers)
      ? parsed.providers.map((item) => normalizeProvider(item, (value, strict) => this.decryptKey(value, strict))).filter((provider): provider is ServerProvider => provider !== null)
      : []
    const recentWorkspaces = Array.isArray(parsed.recentWorkspaces) ? parsed.recentWorkspaces.filter((item): item is string => typeof item === 'string') : []
    const recentWorkspaceOpenedAt: Record<string, string> = isRecord(parsed.recentWorkspaceOpenedAt)
      ? Object.fromEntries(Object.entries(parsed.recentWorkspaceOpenedAt).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {}

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      providers,
      trailblazerProvider: normalizeManagedProviderPreferences(parsed.trailblazerProvider),
      recentWorkspaces,
      recentWorkspaceOpenedAt,
      updatePreferences: normalizeUpdatePreferences(parsed.updatePreferences),
      orchestrationDefaults: normalizeOrchestrationPreferences(parsed.orchestrationDefaults),
      agentGeneration: normalizeAgentGenerationPreferences(parsed.agentGeneration)
    }
  }

  private async loadRaw(): Promise<ServerSettings> {
    try {
      return await this.loadRawStrict()
    } catch {
      return defaultSettings()
    }
  }

  private async loadRawForMutation(): Promise<ServerSettings> {
    try {
      return await this.loadRawStrict()
    } catch (error) {
      if (isFileNotFound(error)) return defaultSettings()
      throw error
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
    const { trailblazerProvider: _trailblazerProvider, ...publicSettings } = settings
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
    return { ...publicSettings, agentGeneration: normalizeAgentGenerationPreferences(settings.agentGeneration), providers }
  }

  load(): Promise<PublicAppSettings> {
    return this.serialized(async () => this.toPublic(await this.loadRaw()))
  }

  managedProviderPreferences(): Promise<ManagedProviderPreferences> {
    return this.serialized(async () => (await this.loadRaw()).trailblazerProvider)
  }

  consumeLegacyCustomPrompt(migrate: (prompt: string) => Promise<void>): Promise<string | undefined> {
    return this.serialized(async () => {
      const settings = await this.loadRawForMutation()
      const prompt = settings.customPrompt.trim()
      if (!prompt) return undefined
      await migrate(prompt)
      await this.persist({ ...settings, customPrompt: '' })
      return prompt
    })
  }

  update(patch: SettingsPatch): Promise<PublicAppSettings> {
    return this.serialized(async () => {
      const current = await this.loadRawForMutation()
      const next = {
        ...current,
        ...patch,
        updatePreferences: normalizeUpdatePreferences(patch.updatePreferences ?? current.updatePreferences),
        orchestrationDefaults: normalizeOrchestrationPreferences(patch.orchestrationDefaults ?? current.orchestrationDefaults),
        agentGeneration: normalizeAgentGenerationPreferences(patch.agentGeneration ?? current.agentGeneration)
      }
      return this.toPublic(await this.persist(next))
    })
  }

  recordRecentWorkspace(path: string, signal?: AbortSignal): Promise<void> {
    return this.serialized(async () => {
      const settings = await this.loadRawForMutation()
      throwIfWorkspaceRequestAborted(signal)
      const recent = markRecentWorkspace(settings, path)
      try {
        await this.persist({ ...settings, ...recent })
        throwIfWorkspaceRequestAborted(signal)
      } catch (error) {
        if (signal?.aborted) await this.saveRaw(settings)
        throw error
      }
    })
  }

  forgetRecentWorkspace(path: string): Promise<void> {
    return this.serialized(async () => {
      const settings = await this.loadRawForMutation()
      await this.persist({ ...settings, ...forgetRecentWorkspace(settings, path) })
    })
  }

  saveProvider(input: ProviderInput): Promise<PublicAppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRawForMutation()
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

  saveTrailblazerProvider(input: Pick<ProviderInput, 'models' | 'modelSettings'> & { modelScope?: string }): Promise<PublicAppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRawForMutation()
      const models = [...new Set(input.models.filter((model) => typeof model === 'string' && model.trim().length > 0))]
      const next = { ...settings, trailblazerProvider: { models, modelSettings: pruneModelSettings(models, input.modelSettings ?? settings.trailblazerProvider.modelSettings), ...((input.modelScope ?? settings.trailblazerProvider.modelScope) ? { modelScope: input.modelScope ?? settings.trailblazerProvider.modelScope } : {}) } }
      return this.toPublic(await this.persist(next))
    })
  }

  deleteProvider(id: string): Promise<PublicAppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRawForMutation()
      const next = {
        ...settings,
        providers: settings.providers.filter((provider) => provider.id !== id),
        defaultChatModel: settings.defaultChatModel?.providerId === id ? undefined : settings.defaultChatModel
      }
      return this.toPublic(await this.persist(next))
    })
  }

  async agentSettings(): Promise<{ providers: Array<{ id: string; protocol: 'openai' | 'anthropic' | 'gemini'; baseUrl: string; apiKey: string; name?: string; modelSettings?: Record<string, ModelSettings> }>; customPrompt?: string; agentGeneration: AgentGenerationPreferences }> {
    const settings = await this.loadRaw()
    return {
      customPrompt: settings.customPrompt,
      agentGeneration: settings.agentGeneration,
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
