/**
 * 应用设置：存于 Electron userData/settings.json。
 * API Key 使用 safeStorage（操作系统级凭据）加密；不可用时降级为明文并标记。
 * 通过注入目录路径保持可测试性；electron 模块在 vitest 环境下安全降级。
 */
import { promises as fs } from 'fs'
import { randomUUID } from 'node:crypto'
import { join } from 'path'
import type {
  AppSettings,
  ManagedProviderPreferences,
  ProviderInput,
  ProviderPublic,
  ProviderStored,
  PublicAppSettings
} from '../../shared/types'
import type { FetchModelsInput } from '../../shared/api'
import { pruneModelSettings } from '../../core/llm/modelCatalog'
import { keyPreview } from '../../shared/keyPreview'
import { forgetRecentWorkspace, markRecentWorkspace } from '../../shared/recentWorkspaces'
import { throwIfWorkspaceRequestAborted } from '../../shared/api'
import { DEFAULT_ORCHESTRATION_PREFERENCES, normalizeOrchestrationPreferences } from '../../shared/creative'
import { DEFAULT_AGENT_GENERATION_PREFERENCES, normalizeAgentGenerationPreferences } from '../../shared/agentGeneration'
import { normalizeUpdatePreferences } from '../../shared/updates'

/* electron 仅在主进程运行时可用，vitest 下返回 null 走降级 */
type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(buf: Buffer): string
}
let cachedSafeStorage: SafeStorageLike | null | undefined
function getSafeStorage(): SafeStorageLike | null {
  if (cachedSafeStorage !== undefined) return cachedSafeStorage
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { safeStorage?: SafeStorageLike }
    cachedSafeStorage = electron?.safeStorage ?? null
  } catch {
    cachedSafeStorage = null
  }
  return cachedSafeStorage
}

export const DEFAULT_SETTINGS: AppSettings = {
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

function defaultSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, agentGeneration: normalizeAgentGenerationPreferences({}) }
}

const DEFAULT_CHAT_FONT_SIZE = 14

function normalizeChatFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHAT_FONT_SIZE
  return Math.round(Math.min(20, Math.max(13, value)))
}

const PLAIN_PREFIX = 'plain:'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProviderProtocol(value: unknown): value is ProviderStored['protocol'] {
  return value === 'openai' || value === 'anthropic' || value === 'gemini'
}

function normalizeProvider(value: unknown): ProviderStored | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.name !== 'string' || !isProviderProtocol(value.protocol) || typeof value.baseUrl !== 'string') return null
  const models = Array.isArray(value.models) ? value.models.filter((model): model is string => typeof model === 'string') : []
  const modelSettings = isRecord(value.modelSettings)
    ? Object.fromEntries(Object.entries(value.modelSettings).filter((entry) => isRecord(entry[1]))) as ProviderStored['modelSettings']
    : {}
  return {
    ...value,
    id: value.id,
    name: value.name,
    protocol: value.protocol,
    baseUrl: value.baseUrl,
    apiKeyEncrypted: typeof value.apiKeyEncrypted === 'string' ? value.apiKeyEncrypted : '',
    models,
    modelSettings
  }
}

function normalizeProviders(value: unknown): ProviderStored[] {
  return Array.isArray(value) ? value.map(normalizeProvider).filter((provider): provider is ProviderStored => provider !== null) : []
}

function normalizeSettings(raw: unknown): AppSettings {
  const parsed = isRecord(raw) ? raw : {}
  const providers = normalizeProviders(parsed.providers)
  const recentWorkspaces = Array.isArray(parsed.recentWorkspaces)
    ? parsed.recentWorkspaces.filter((item): item is string => typeof item === 'string')
    : []
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
    agentGeneration: normalizeAgentGenerationPreferences(parsed.agentGeneration),
    chatFontSize: normalizeChatFontSize(parsed.chatFontSize)
  }
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

export function encryptApiKey(plain: string): string {
  const ss = getSafeStorage()
  if (ss && ss.isEncryptionAvailable()) {
    return ss.encryptString(plain).toString('base64')
  }
  return PLAIN_PREFIX + Buffer.from(plain, 'utf-8').toString('base64')
}

/** 解密失败时返回空串（例如换机后凭据不可用），由调用方提示用户重填 */
export function decryptApiKey(stored: string): string {
  if (!stored) return ''
  try {
    if (stored.startsWith(PLAIN_PREFIX)) {
      return Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString('utf-8')
    }
    const ss = getSafeStorage()
    if (!ss) return ''
    return ss.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}

export class SettingsService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private filePath: string) {}

  /** IPC handler 并发执行，读写必须排队避免读改写互相覆盖 */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  load(): Promise<AppSettings> {
    return this.serialized(() => this.loadRaw())
  }

  consumeLegacyCustomPrompt(migrate: (prompt: string) => Promise<void>): Promise<string | undefined> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const prompt = settings.customPrompt.trim()
      if (!prompt) return undefined
      await migrate(prompt)
      await this.saveRaw({ ...settings, customPrompt: '' })
      return prompt
    })
  }

  private async loadRaw(): Promise<AppSettings> {
    try {
      return normalizeSettings(JSON.parse(await fs.readFile(this.filePath, 'utf-8')))
    } catch {
      return defaultSettings()
    }
  }

  private async saveRaw(settings: AppSettings): Promise<void> {
    await fs.mkdir(join(this.filePath, '..'), { recursive: true })
    const temp = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 })
      await fs.chmod(temp, 0o600).catch(() => undefined)
      await fs.rename(temp, this.filePath)
      await fs.chmod(this.filePath, 0o600).catch(() => undefined)
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined)
    }
  }

  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.serialized(async () => {
      const next = normalizeSettings({ ...(await this.loadRaw()), ...patch })
      await this.saveRaw(next)
      return next
    })
  }

  recordRecentWorkspace(path: string, signal?: AbortSignal): Promise<AppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      throwIfWorkspaceRequestAborted(signal)
      const recent = markRecentWorkspace({
        recentWorkspaces: settings.recentWorkspaces,
        recentWorkspaceOpenedAt: settings.recentWorkspaceOpenedAt
      }, path)
      const next = { ...settings, ...recent, lastWorkspacePath: path }
      try {
        await this.saveRaw(next)
        throwIfWorkspaceRequestAborted(signal)
      } catch (error) {
        if (signal?.aborted) await this.saveRaw(settings)
        throw error
      }
      return next
    })
  }

  forgetRecentWorkspace(path: string): Promise<AppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const recent = forgetRecentWorkspace(settings, path)
      const next = { ...settings, ...recent, lastWorkspacePath: settings.lastWorkspacePath === path ? undefined : settings.lastWorkspacePath }
      await this.saveRaw(next)
      return next
    })
  }

  saveProvider(input: ProviderInput): Promise<AppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const list = [...settings.providers]
      const idx = input.id ? list.findIndex((p) => p.id === input.id) : -1
      let stored: ProviderStored
      if (idx >= 0) {
        const old = list[idx]
        stored = {
          ...old,
          name: input.name,
          protocol: input.protocol,
          baseUrl: input.baseUrl,
          models: input.models,
          modelSettings: pruneModelSettings(input.models, input.modelSettings ?? old.modelSettings),
          apiKeyEncrypted: input.apiKey ? encryptApiKey(input.apiKey) : old.apiKeyEncrypted
        }
        list[idx] = stored
      } else {
        stored = {
          id: `prov_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: input.name,
          protocol: input.protocol,
          baseUrl: input.baseUrl,
          models: input.models,
          modelSettings: pruneModelSettings(input.models, input.modelSettings),
          apiKeyEncrypted: encryptApiKey(input.apiKey ?? '')
        }
        list.push(stored)
      }
      const next = { ...settings, providers: list }
      await this.saveRaw(next)
      return next
    })
  }

  saveTrailblazerProvider(input: Pick<ProviderInput, 'models' | 'modelSettings'> & { modelScope?: string }): Promise<AppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const models = [...new Set(input.models.filter((model) => typeof model === 'string' && model.trim().length > 0))]
      const next = { ...settings, trailblazerProvider: { models, modelSettings: pruneModelSettings(models, input.modelSettings ?? settings.trailblazerProvider.modelSettings), ...((input.modelScope ?? settings.trailblazerProvider.modelScope) ? { modelScope: input.modelScope ?? settings.trailblazerProvider.modelScope } : {}) } }
      await this.saveRaw(next)
      return next
    })
  }

  deleteProvider(id: string): Promise<AppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const providers = settings.providers.filter((p) => p.id !== id)
      const patch: Partial<AppSettings> = { providers }
      if (settings.defaultChatModel?.providerId === id) patch.defaultChatModel = undefined
      const next = { ...settings, ...patch }
      await this.saveRaw(next)
      return next
    })
  }

  toPublic(settings: AppSettings): PublicAppSettings {
    const { trailblazerProvider: _trailblazerProvider, ...publicSettings } = settings
    return {
      ...publicSettings,
      agentGeneration: normalizeAgentGenerationPreferences(settings.agentGeneration),
      providers: settings.providers.map(
        (p): ProviderPublic => {
          const plain = decryptApiKey(p.apiKeyEncrypted)
          return {
            id: p.id,
            name: p.name,
            protocol: p.protocol,
            baseUrl: p.baseUrl,
            models: p.models,
              hasKey: Boolean(plain),
              keyPreview: keyPreview(plain),
              keyStorage: !p.apiKeyEncrypted ? 'none' : p.apiKeyEncrypted.startsWith('plain:') ? 'plain' : 'encrypted',
            modelSettings: p.modelSettings ?? {}
          }
        }
      )
    }
  }

  /** 取某供应商解密后的 Key（仅主进程内部使用，如发起 LLM 请求） */
  async apiKeyOf(providerId: string): Promise<string> {
    const s = await this.load()
    const p = s.providers.find((x) => x.id === providerId)
    return p ? decryptApiKey(p.apiKeyEncrypted) : ''
  }

  async providerInput(input: FetchModelsInput): Promise<{ protocol: FetchModelsInput['protocol']; baseUrl: string; apiKey: string }> {
    if (!input.providerId) return { protocol: input.protocol, baseUrl: input.baseUrl, apiKey: input.apiKey ?? '' }
    const settings = await this.load()
    const provider = settings.providers.find((item) => item.id === input.providerId)
    if (!provider) throw new Error('供应商不存在')
    return {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: input.apiKey ?? decryptApiKey(provider.apiKeyEncrypted)
    }
  }
}
