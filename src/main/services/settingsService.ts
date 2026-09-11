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
  ProviderInput,
  ProviderPublic,
  ProviderStored,
  PublicAppSettings
} from '../../shared/types'
import type { FetchModelsInput } from '../../shared/api'
import { pruneModelSettings } from '../../core/llm/modelCatalog'
import { keyPreview } from '../../shared/keyPreview'

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

const PLAIN_PREFIX = 'plain:'

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

  private async loadRaw(): Promise<AppSettings> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf-8')) as Partial<AppSettings>
      return { ...DEFAULT_SETTINGS, ...raw }
    } catch {
      return { ...DEFAULT_SETTINGS }
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
      const next = { ...(await this.loadRaw()), ...patch }
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

  deleteProvider(id: string): Promise<AppSettings> {
    return this.serialized(async () => {
      const settings = await this.loadRaw()
      const providers = settings.providers.filter((p) => p.id !== id)
      const patch: Partial<AppSettings> = { providers }
      if (settings.defaultChatModel?.providerId === id) patch.defaultChatModel = undefined
      if (settings.quickActionModel?.providerId === id) patch.quickActionModel = undefined
      const next = { ...settings, ...patch }
      await this.saveRaw(next)
      return next
    })
  }

  toPublic(settings: AppSettings): PublicAppSettings {
    return {
      ...settings,
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
