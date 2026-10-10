import { Preferences } from '@capacitor/preferences'
import { readWritingTools, writeWritingTools } from '../../../core/workspace/writingTools'
import type { WritingToolsPreferences } from '../../../shared/writingTools'
import { checkForUpdates, normalizeUpdatePreferences } from '../../../shared/updates'
import { APP_VERSION } from '../lib/appVersion'
import { Clipboard } from '@capacitor/clipboard'
import { createCapacitorWebFetch } from './capacitorWebFetch'
import { createCapacitorCloudModelFetch } from './capacitorCloudModelFetch'
import { androidCloudAccount } from './capacitorCloudAccount'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { Share } from '@capacitor/share'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { throwIfWorkspaceRequestAborted } from '../../../shared/api'
import type { AgentEventEnvelope, RuntimeAgentEventEnvelope, StoryFabricApi, WorkspaceImportTarget, WorkspaceRequestOptions } from '../../../shared/api'
import type { FetchModelsInput, SettingsPatch } from '../../../shared/api'
import { TRAILBLAZER_PROVIDER_ID } from '../../../shared/cloudAccount'
import type { AgentQuestionAnswer, SkillCandidateAction } from '../../../shared/agentQuestions'
import type { WorkspaceArchive } from '../../../core/workspace/archive'
import type { ChapterBox, ChapterDoc, CharacterDoc, ChatSession, GoalRun, ManagedProviderPreferences, NoteDoc, NoteMeta, OutlineDoc, ProviderInput, ProviderPublic, PublicAppSettings, Relationship, RunAgentRequest, SessionMeta, SettingDoc, SettingMeta, StoryEvent, TrashEntry, UsageRecord, VolumeMeta, WorkspaceListItem, WorkspaceSummary } from '../../../shared/types'
import { CapacitorFileStore } from './capacitorFileStore'
import { SafFileStore, documentTree, makeSafPath, parseSafPath } from './safFileStore'
import type { FileStore } from '../../../core/storage/fileStore'
import { getDocumentSnapshot, saveDocument, saveHistoryVersion, listHistoryVersions, getHistoryVersion, updateHistoryVersion, deleteHistoryVersion, restoreHistoryVersion } from '../../../core/workspace/documentWrites'
import { bytesToBase64 } from './archiveTransfer'
import { deleteChapter, deleteCharacter, deleteEvent, deleteNote, deleteOutlineDoc, deleteSetting, getChapterBody, getNote, getSetting, listChapters, listCharacters, listEvents, listNotes, listOutline, listSettings, loadRelationships, saveChapter, saveCharacter, saveEvent, saveNote, saveOutlineDoc, saveRelationships, saveSetting, searchProject } from '../../../core/workspace/entityStore'
import { deleteVolume, initializeWorkspace, listVolumes, loadSummary, loadWorkspaceListItem, moveChapter, readGraphLayout, saveVolume, setWorkspaceName, validateWorkspace, writeGraphLayout } from '../../../core/workspace/workspaceService'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../../../core/workspace/archive'
import { decodeSessionArchive, exportSessionArchive, type SessionArchive } from '../../../core/workspace/sessionArchive'
import { genId } from '../../../core/workspace/entityStore'
import { listTrash, purgeTrashEntry, restoreFromTrash } from '../../../core/workspace/trash'
import { CoreSessionStore } from '../../../core/workspace/sessionStore'
import { CoreAgentService } from '../../../core/agent/agentLoop'
import { PortableUsageStore } from '../../../core/usage/portableUsageStore'
import { listWritingDays } from '../../../core/usage/writingStats'
import { fetchProviderModels, getAdapter } from '../../../core/llm'
import { pruneModelSettings } from '../../../core/llm/modelCatalog'
import { keyPreview } from '../../../shared/keyPreview'
import { forgetRecentWorkspace, markRecentWorkspace, orderRecentWorkspacePaths } from '../../../shared/recentWorkspaces'
import type { PlatformCapabilities } from '../../../shared/platformCapabilities'
import { adaptLegacyAgentEvent, legacyEventIdentity } from '../../../shared/agentRuntime'
import { RunEventBuffer, type RunReplay } from '../../../shared/runEvents'
import { creativePreferencesFromOrchestrationDefaults, DEFAULT_ORCHESTRATION_PREFERENCES, normalizeOrchestrationPreferences, type CreativePackageSummary } from '../../../shared/creative'
import { DEFAULT_AGENT_GENERATION_PREFERENCES, normalizeAgentGenerationPreferences } from '../../../shared/agentGeneration'
import { summarizeContentPackage } from '../../../core/skills/packageStore'
import { GlobalSkillLibrary } from '../../../core/skills/globalSkillLibrary'
import { MemoryStore } from '../../../core/memory/memoryStore'
import type { MemoryScope, MemoryUpdate } from '../../../shared/memory'
import { builtinPackages } from '../../../core/skills/builtin'
import type { ContentPackage } from '../../../shared/skillPackage'
import type { RuleLayer } from '../../../core/rules/types'
import { GoalStore } from '../../../core/goal/goalStore'
import { RuleStore } from '../../../core/rules/ruleStore'

const SETTINGS_KEY = 'storyfabric.settings'
const TRAILBLAZER_PROVIDER_KEY = 'storyfabric.trailblazer-provider'
const EXTERNAL_WORKSPACES_KEY = 'storyfabric.external-workspaces'
const WORKSPACE_PREFIX = 'workspaces'
const TRAILBLAZER_BASE_URL = 'https://trasub2api.fengyao.xin:10048/api/v1/integration/storyfabric/gateway/v1'
const ANDROID_WORKSPACE_PATH_ERROR = 'Android 工作区路径必须位于应用内部 workspaces 目录下'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isProviderProtocol(value: unknown): value is ProviderPublic['protocol'] {
  return value === 'openai' || value === 'anthropic' || value === 'gemini'
}

function isKeyStorage(value: unknown): value is NonNullable<ProviderPublic['keyStorage']> {
  return value === 'encrypted' || value === 'plain' || value === 'none'
}

function normalizeProvider(value: unknown): ProviderPublic | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.name !== 'string' || !isProviderProtocol(value.protocol) || typeof value.baseUrl !== 'string') return null
  const models = Array.isArray(value.models) ? value.models.filter((model): model is string => typeof model === 'string') : []
  const modelSettings = isRecord(value.modelSettings)
    ? Object.fromEntries(Object.entries(value.modelSettings).filter((entry) => isRecord(entry[1]))) as ProviderPublic['modelSettings']
    : {}
  return {
    id: value.id,
    name: value.name,
    protocol: value.protocol,
    baseUrl: value.baseUrl,
    models,
    hasKey: typeof value.hasKey === 'boolean' ? value.hasKey : false,
    ...(typeof value.keyPreview === 'string' ? { keyPreview: value.keyPreview } : {}),
    ...(isKeyStorage(value.keyStorage) ? { keyStorage: value.keyStorage } : {}),
    modelSettings
  }
}

export function normalizeAndroidWorkspacePath(input: string): string {
  const value = input.trim()
  const match = new RegExp(`^${WORKSPACE_PREFIX}/([^/\\\\]+)$`).exec(value)
  if (!match || match[1] === '.' || match[1] === '..') throw new Error(ANDROID_WORKSPACE_PATH_ERROR)
  return value
}

function normalizeAnyWorkspacePath(input: string): string {
  const external = parseSafPath(input)
  return external ? makeSafPath(external.treeUri, external.root) : normalizeAndroidWorkspacePath(input)
}

function workspaceStoreForPath(path: string): FileStore {
  return parseSafPath(path) ? new SafFileStore(path) : new CapacitorFileStore(path)
}

function workspaceFallbackName(path: string): string {
  return parseSafPath(path)?.root || path.split('/').pop() || 'StoryFabric'
}

let androidImportQueue: Promise<void> = Promise.resolve()

function withAndroidImportLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = androidImportQueue.catch(() => undefined).then(operation)
  androidImportQueue = run.then(() => undefined, () => undefined)
  return run
}

let androidSettingsQueue: Promise<void> = Promise.resolve()

function withAndroidSettingsLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = androidSettingsQueue.catch(() => undefined).then(operation)
  androidSettingsQueue = run.then(() => undefined, () => undefined)
  return run
}

const DEFAULT_PUBLIC: PublicAppSettings = {
  updatePreferences: normalizeUpdatePreferences(undefined),
  providers: [],
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

function defaultPublicSettings(): PublicAppSettings {
  return { ...DEFAULT_PUBLIC, agentGeneration: normalizeAgentGenerationPreferences({}) }
}

/** Android 平台 API：应用私有目录工作区，密钥使用 Android Keystore-backed secure storage。 */
export class AndroidPlatformApi implements StoryFabricApi {
  readonly cloudAccount = androidCloudAccount
  private currentPath: string | null = null
  private currentStore: FileStore | null = null
  private settings: PublicAppSettings = defaultPublicSettings()
  private agent: CoreAgentService | null = null
  private usage: PortableUsageStore | null = null
  private managedModelsCache?: { scope: string; models: string[] }

  getUiSource(): string { return 'android-local' }
  async clipboardReadText(): Promise<string> {
    const result = await Clipboard.read()
    return result.value
  }
  async clipboardWriteText(text: string): Promise<void> {
    await Clipboard.write({ string: text })
  }

  getCapabilities(): Promise<PlatformCapabilities> {
    return Promise.resolve({ protocolVersion: 1, skills: true, rules: true, orchestration: true, subagents: true, goalMode: true, eventRecovery: true, budgets: true, orientation: 'best-effort', fileImportExport: true, remoteDeployment: false })
  }

  async listCreativePackages(): Promise<CreativePackageSummary[]> {
    const packageStore = new GlobalSkillLibrary(new CapacitorFileStore())
    const installed = await packageStore.list()
    const builtins = builtinPackages.map((pkg) => {
      const saved = installed.find((item) => item.manifest.id === pkg.manifest.id && item.manifest.version === pkg.manifest.version)
      return { id: pkg.manifest.id, version: pkg.manifest.version, name: pkg.manifest.name, description: pkg.manifest.description, enabled: saved?.enabled ?? true, skills: pkg.manifest.skills.map((item) => item.id), ruleSets: pkg.manifest.ruleSets.map((item) => item.id) }
    })
    return [...builtins, ...installed.filter((item) => !builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version)).map(summarizeContentPackage)]
  }

  async setCreativePackageEnabled(id: string, version: string, enabled: boolean): Promise<CreativePackageSummary> {
    const packageStore = new GlobalSkillLibrary(new CapacitorFileStore())
    const builtin = builtinPackages.find((pkg) => pkg.manifest.id === id && pkg.manifest.version === version)
    return summarizeContentPackage(await (builtin ? packageStore.install(builtin, enabled) : packageStore.setEnabled(id, version, enabled)))
  }

  async installCreativePackage(input: ContentPackage): Promise<CreativePackageSummary> {
    return summarizeContentPackage(await new GlobalSkillLibrary(new CapacitorFileStore()).install(input, true))
  }

  listCreativeRules(): Promise<RuleLayer[]> { return new RuleStore(this.requireStore()).load() }
  saveCreativeRules(layers: RuleLayer[]): Promise<void> { return new RuleStore(this.requireStore()).save(layers) }
  async listInspirationSources(): Promise<import('../../../shared/inspiration').InspirationSource[]> { return new (await import('../../../core/inspiration/sourceCatalog')).SourceCatalog(this.requireStore()).list() }
  async importInspirationSource(input: import('../../../shared/inspiration').InspirationImport): Promise<import('../../../shared/inspiration').InspirationSource> { return new (await import('../../../core/inspiration/sourceCatalog')).SourceCatalog(this.requireStore()).importBytes(input) }
  importInspirationPath(): Promise<never> { return Promise.reject(new Error('Android 请先将资料导入应用后再使用灵感台')) }
  async removeInspirationSource(id: string): Promise<void> { return new (await import('../../../core/inspiration/sourceCatalog')).SourceCatalog(this.requireStore()).removeImported(id) }
  async extractInspirationSource(id: string): Promise<import('../../../shared/inspiration').InspirationSource> { return new (await import('../../../core/inspiration/sourceCatalog')).SourceCatalog(this.requireStore()).extract(id) }
  async readInspirationSource(id: string, maxChars?: number): Promise<string> { return new (await import('../../../core/inspiration/sourceCatalog')).SourceCatalog(this.requireStore()).readExtracted(id, maxChars) }
  async readInspirationDoc(name: string): Promise<string | null> { const { normalizeProjectDocPath } = await import('../../../core/workspace/projectDocs'); return this.requireStore().readText(`docs/${normalizeProjectDocPath(name)}`) }
  async saveInspirationDoc(name: string, content: string): Promise<void> { const { normalizeProjectDocPath, validateProjectDocContent } = await import('../../../core/workspace/projectDocs'); const path = normalizeProjectDocPath(name); validateProjectDocContent(content); await this.requireStore().writeText(`docs/${path}`, content) }
  async saveInspirationArtifact(input: import('../../../shared/inspiration').InspirationArtifactInput): Promise<void> { const { saveInspirationArtifact } = await import('../../../core/inspiration/inspirationService'); await saveInspirationArtifact(this.requireStore(), input) }

  private keyName(providerId: string): string { return `provider-api-key:${providerId}` }

  private async keyOf(providerId: string): Promise<string> {
    try { return (await SecureStorage.getItem(this.keyName(providerId))) ?? '' } catch { return '' }
  }

  private async loadSettingsFromPreferences(): Promise<PublicAppSettings> {
    const raw = await Preferences.get({ key: SETTINGS_KEY })
    if (!raw.value) {
      this.settings = defaultPublicSettings()
      return this.settings
    }
    try {
      this.settings = this.normalizeSettings(JSON.parse(raw.value))
    } catch {
      this.settings = defaultPublicSettings()
    }
    return this.settings
  }

  private loadSettings(): Promise<PublicAppSettings> {
    return withAndroidSettingsLock(() => this.loadSettingsFromPreferences())
  }

  private async loadManagedPreferences(): Promise<ManagedProviderPreferences> {
    const raw = await Preferences.get({ key: TRAILBLAZER_PROVIDER_KEY })
    if (!raw.value) return { models: [], modelSettings: {} }
    try {
      const value: unknown = JSON.parse(raw.value)
      if (!isRecord(value)) return { models: [], modelSettings: {} }
      const models = Array.isArray(value.models) ? value.models.filter((model): model is string => typeof model === 'string') : []
      const modelSettings = isRecord(value.modelSettings) ? value.modelSettings as ManagedProviderPreferences['modelSettings'] : {}
      return { models, modelSettings, ...(typeof value.modelScope === 'string' ? { modelScope: value.modelScope } : {}) }
    } catch { return { models: [], modelSettings: {} } }
  }

  private async saveManagedPreferences(preferences: ManagedProviderPreferences): Promise<void> {
    await Preferences.set({ key: TRAILBLAZER_PROVIDER_KEY, value: JSON.stringify(preferences) })
  }

  private async managedPublicProvider(): Promise<ProviderPublic> {
    const [state, preferences, scope] = await Promise.all([
      androidCloudAccount.getState(),
      this.loadManagedPreferences(),
      androidCloudAccount.getPreferenceScope().catch(() => undefined)
    ])
    const active = state.phase === 'signed-in'
    const ownsPreferences = active && Boolean(scope) && preferences.modelScope === scope
    let models = active ? (ownsPreferences ? [...preferences.models] : []) : [...preferences.models]
    const modelSettings = active && !ownsPreferences ? {} : preferences.modelSettings
    if (active && !ownsPreferences && !models.length && scope) {
      if (this.managedModelsCache?.scope === scope) models = [...this.managedModelsCache.models]
      else {
        try {
          models = await androidCloudAccount.getModels('openai')
          this.managedModelsCache = { scope, models: [...models] }
        } catch { /* Account details remain available when model listing is temporarily offline. */ }
      }
    }
    return {
      id: TRAILBLAZER_PROVIDER_ID,
      name: 'Trailblazer 云端',
      protocol: 'openai',
      baseUrl: TRAILBLAZER_BASE_URL,
      models,
      hasKey: false,
      authentication: 'trailblazer-session',
      keyStorage: 'none',
      modelSettings,
      managed: 'trailblazer',
      active
    }
  }

  private async withManagedProvider(settings: PublicAppSettings): Promise<PublicAppSettings> {
    const provider = await this.managedPublicProvider()
    return { ...settings, providers: [...settings.providers.filter((item) => item.id !== TRAILBLAZER_PROVIDER_ID), provider] }
  }

  private normalizeSettings(value: unknown): PublicAppSettings {
    const parsed = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<PublicAppSettings>
      : {}
    const recentWorkspaces = Array.isArray(parsed.recentWorkspaces)
      ? parsed.recentWorkspaces.filter((path): path is string => typeof path === 'string')
      : []
    const openedAt = parsed.recentWorkspaceOpenedAt
    const recentWorkspaceOpenedAt = openedAt && typeof openedAt === 'object' && !Array.isArray(openedAt)
      ? Object.fromEntries(Object.entries(openedAt).filter(([, timestamp]) => typeof timestamp === 'string'))
      : {}
    const providers = Array.isArray(parsed.providers)
      ? parsed.providers.map(normalizeProvider).filter((provider): provider is ProviderPublic => provider !== null)
      : []
    const lastWorkspacePath = typeof parsed.lastWorkspacePath === 'string' ? parsed.lastWorkspacePath : undefined
    return {
      ...DEFAULT_PUBLIC,
      ...parsed,
      providers,
      recentWorkspaces,
      recentWorkspaceOpenedAt,
      lastWorkspacePath,
      updatePreferences: normalizeUpdatePreferences(parsed.updatePreferences),
      orchestrationDefaults: normalizeOrchestrationPreferences(parsed.orchestrationDefaults),
      agentGeneration: normalizeAgentGenerationPreferences(parsed.agentGeneration)
    }
  }

  private async saveSettings(): Promise<void> {
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(this.settings) })
  }

  private requireStore(): FileStore {
    if (!this.currentStore) throw new Error('尚未打开工作区')
    return this.currentStore
  }

  private installWorkspace(path: string, store: FileStore): void {
    const workspaceUsage = new PortableUsageStore(store)
    const nativeFetch = createCapacitorWebFetch()
    const longNativeFetch = createCapacitorWebFetch(undefined, 180000)
    const cloudFetch = createCapacitorCloudModelFetch(nativeFetch)
    const cloudGeminiFetch = createCapacitorCloudModelFetch(longNativeFetch)
    const agent = new CoreAgentService({
      store,
      webFetch: nativeFetch,
      workspaceId: path,
      sessions: new CoreSessionStore(store),
      getAdapter: (protocol, baseUrl, options) => getAdapter(protocol, baseUrl, {
        ...options,
        fetcher: cloudFetch,
        ...(protocol === 'gemini' ? { fallbackFetcher: cloudGeminiFetch } : {})
      }),
      settings: async () => {
        const s = await this.loadSettings()
        const providers: import('../../../core/agent/agentLoop').AgentSettings['providers'] = await Promise.all(s.providers.map(async (p) => ({ id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, apiKey: await this.keyOf(p.id), modelSettings: p.modelSettings })))
        const state = await androidCloudAccount.getState()
        if (state.phase === 'signed-in') {
          const preferences = await this.loadManagedPreferences()
          const scope = await androidCloudAccount.getPreferenceScope().catch(() => undefined)
          providers.push({
            id: TRAILBLAZER_PROVIDER_ID,
            name: 'Trailblazer 云端',
            protocol: 'openai',
            baseUrl: TRAILBLAZER_BASE_URL,
            apiKey: '',
            modelSettings: scope && preferences.modelScope === scope ? preferences.modelSettings : {},
            authentication: 'trailblazer-session',
            adapter: getAdapter('openai', TRAILBLAZER_BASE_URL, { fetcher: cloudFetch }),
            fetcher: cloudFetch
          })
        }
        return { customPrompt: s.customPrompt, agentGeneration: s.agentGeneration, providers }
      },
      consumeLegacyCustomPrompt: (migrate) => withAndroidSettingsLock(async () => {
        await this.loadSettingsFromPreferences()
        const prompt = this.settings.customPrompt.trim()
        if (!prompt) return undefined
        await migrate(prompt)
        this.settings = { ...this.settings, customPrompt: '' }
        await this.saveSettings()
        return prompt
      }),
      emit: (sessionId, event, runId) => this.emitAgentEvent(sessionId, event, runId),
      onUsage: (record) => { void workspaceUsage.append(record).catch(() => undefined) },
      globalSkillLibrary: new GlobalSkillLibrary(new CapacitorFileStore())
      ,memoryStore: new MemoryStore(new CapacitorFileStore(), store)
    })
    if (this.currentPath && this.currentPath !== path) {
      this.runtimeBuffers.clear()
      this.runtimeSequences.clear()
      this.runtimeTouched.clear()
    }
    this.currentPath = path
    this.currentStore = store
    this.usage = workspaceUsage
    this.agent = agent
  }

  async pickFolder(): Promise<string | null> {
    const selected = await documentTree.pickDirectory()
    return selected.uri ? makeSafPath(selected.uri) : null
  }

  private async externalWorkspacePaths(): Promise<string[]> {
    const raw = await Preferences.get({ key: EXTERNAL_WORKSPACES_KEY })
    if (!raw.value) return []
    try {
      const paths: unknown = JSON.parse(raw.value)
      return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string' && Boolean(parseSafPath(path))) : []
    } catch { return [] }
  }

  private async registerExternalWorkspace(path: string): Promise<void> {
    if (!parseSafPath(path)) return
    const paths = await this.externalWorkspacePaths()
    if (!paths.includes(path)) await Preferences.set({ key: EXTERNAL_WORKSPACES_KEY, value: JSON.stringify([...paths, path]) })
  }

  private async allWorkspacePaths(): Promise<string[]> {
    const dirs = await new CapacitorFileStore(WORKSPACE_PREFIX).listDirs('')
    return [...dirs.map((dir) => normalizeAndroidWorkspacePath(`${WORKSPACE_PREFIX}/${dir}`)), ...await this.externalWorkspacePaths()]
  }

  async listWorkspaces(): Promise<WorkspaceListItem[]> {
    const result: WorkspaceListItem[] = []
    for (const path of await this.allWorkspacePaths()) {
      try {
        const store = workspaceStoreForPath(path)
        if (!(await validateWorkspace(store)).ok) continue
        result.push(await loadWorkspaceListItem(store, workspaceFallbackName(path), path))
      } catch {
        /* Skip inaccessible, revoked or damaged workspaces; users can reselect an external folder. */
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  async listRecentWorkspaces(): Promise<WorkspaceListItem[]> {
    const settings = await this.loadSettings()
    const paths = orderRecentWorkspacePaths(settings.recentWorkspaces, settings.recentWorkspaceOpenedAt)
    const result: WorkspaceListItem[] = []
    for (const path of paths) {
      try {
        const normalizedPath = normalizeAnyWorkspacePath(path)
        const store = workspaceStoreForPath(normalizedPath)
        if (!(await validateWorkspace(store)).ok) continue
        const item = await loadWorkspaceListItem(store, workspaceFallbackName(normalizedPath), normalizedPath)
        const lastOpenedAt = settings.recentWorkspaceOpenedAt[normalizedPath]
        result.push(lastOpenedAt ? { ...item, lastOpenedAt } : item)
        if (result.length >= 5) break
      } catch {
        /* 跳过非法、已删除、损坏或正在写入中的工作区。 */
      }
    }
    return result
  }

  async renameWorkspace(path: string, name: string): Promise<WorkspaceListItem> {
    const normalizedPath = normalizeAnyWorkspacePath(path)
    const store = workspaceStoreForPath(normalizedPath)
    const valid = await validateWorkspace(store)
    if (!valid.ok) throw new Error(valid.reason)
    await setWorkspaceName(store, name)
    return loadWorkspaceListItem(store, workspaceFallbackName(normalizedPath), normalizedPath)
  }

  async forgetRecentWorkspace(path: string): Promise<void> {
    const normalizedPath = normalizeAnyWorkspacePath(path)
    await withAndroidSettingsLock(async () => {
      await this.loadSettingsFromPreferences()
      const recent = forgetRecentWorkspace(this.settings, normalizedPath)
      this.settings = { ...this.settings, ...recent, lastWorkspacePath: this.settings.lastWorkspacePath === normalizedPath ? undefined : this.settings.lastWorkspacePath }
      await this.saveSettings()
    })
  }

  getDefaultWorkspaceDir(): Promise<string> { return Promise.resolve(WORKSPACE_PREFIX) }

  async createWorkspace(parentDir: string, name: string): Promise<string> {
    const safe = name.replace(/[\\/:*?"<>|]/g, '').trim()
    if (!safe) throw new Error('工作区名称不能为空')
    const external = parseSafPath(parentDir)
    if (external?.root) throw new Error('请选择外部父文件夹')
    const folder = `${safe}_${Date.now().toString(36)}`
    const path = external ? makeSafPath(external.treeUri, folder) : `${WORKSPACE_PREFIX}/${folder}`
    const store = workspaceStoreForPath(path)
    if (await store.exists('storyfabric.json')) throw new Error('工作区已存在')
    if (external) await documentTree.mkdir({ treeUri: external.treeUri, root: '', path: folder, exclusive: true })
    try { await initializeWorkspace(store, safe) }
    catch (error) {
      if (external) await new SafFileStore(makeSafPath(external.treeUri)).remove(folder).catch(() => undefined)
      throw error
    }
    return path
  }

  async openWorkspace(path: string, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary> {
    const normalizedPath = normalizeAnyWorkspacePath(path)
    const store = workspaceStoreForPath(normalizedPath)
    throwIfWorkspaceRequestAborted(options?.signal)
    const valid = await validateWorkspace(store)
    if (!valid.ok) throw new Error(valid.reason)
    throwIfWorkspaceRequestAborted(options?.signal)
    const summary = await loadSummary(store, workspaceFallbackName(normalizedPath), normalizedPath, { upgradeLegacy: options?.upgradeLegacy === true })
    throwIfWorkspaceRequestAborted(options?.signal)
    await this.recordRecentWorkspace(normalizedPath, options?.signal)
    throwIfWorkspaceRequestAborted(options?.signal)
    this.installWorkspace(normalizedPath, store)
    return summary
  }

  private async recordRecentWorkspace(path: string, signal?: AbortSignal): Promise<void> {
    return withAndroidSettingsLock(async () => {
      throwIfWorkspaceRequestAborted(signal)
      const previous = this.settings
      await this.loadSettingsFromPreferences()
      throwIfWorkspaceRequestAborted(signal)
      const recent = markRecentWorkspace({
        recentWorkspaces: this.settings.recentWorkspaces,
        recentWorkspaceOpenedAt: this.settings.recentWorkspaceOpenedAt
      }, path)
      this.settings = { ...this.settings, ...recent, lastWorkspacePath: path }
      try {
        await this.saveSettings()
        await this.registerExternalWorkspace(path).catch(() => undefined)
        throwIfWorkspaceRequestAborted(signal)
      } catch (error) {
        if (signal?.aborted) {
          this.settings = previous
          await this.saveSettings()
        }
        throw error
      }
    })
  }

  async openWorkspaceByPath(path: string, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary> {
    return this.openWorkspace(normalizeAnyWorkspacePath(path), options)
  }

  async closeWorkspace(): Promise<void> {
    this.currentPath = null
    this.currentStore = null
    this.agent = null
    this.usage = null
    this.runtimeBuffers.clear()
    this.runtimeSequences.clear()
    this.runtimeTouched.clear()
  }

  async getCurrentWorkspace(): Promise<WorkspaceSummary | null> {
    if (!this.currentStore || !this.currentPath) {
      await this.loadSettings()
      const path = this.settings.lastWorkspacePath
      if (path) {
        const normalizedPath = normalizeAnyWorkspacePath(path)
        try {
          const store = workspaceStoreForPath(normalizedPath)
          if ((await validateWorkspace(store)).ok) {
            const summary = await loadSummary(store, workspaceFallbackName(normalizedPath), normalizedPath)
            await this.installWorkspace(normalizedPath, store)
            return summary
          }
        } catch { /* An external directory can be removed or lose its grant. */ }
      }
    }
    if (!this.currentStore || !this.currentPath) return null
    return loadSummary(this.currentStore, workspaceFallbackName(this.currentPath), this.currentPath)
  }

  private eventListeners = new Set<(envelope: AgentEventEnvelope) => void>()
  private runtimeEventListeners = new Set<(envelope: RuntimeAgentEventEnvelope) => void>()
  private runtimeBuffers = new Map<string, RunEventBuffer>()
  private runtimeSequences = new Map<string, number>()
  private runtimeTouched = new Map<string, number>()
  private readonly maxRuntimeRuns = 32

  private ensureRuntimeCapacity(key: string): void {
    if (this.runtimeBuffers.has(key)) return
    while (this.runtimeBuffers.size >= this.maxRuntimeRuns) {
      const oldest = [...this.runtimeTouched.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
      if (!oldest) break
      this.runtimeBuffers.delete(oldest)
      this.runtimeSequences.delete(oldest)
      this.runtimeTouched.delete(oldest)
    }
  }

  private emitAgentEvent(sessionId: string, event: AgentEventEnvelope['event'], runId?: string): void {
    for (const listener of this.eventListeners) listener({ sessionId, ...(runId ? { runId } : {}), event })
    if (!runId) return
    const workspaceId = this.currentPath ?? 'android'
    const key = `${workspaceId}\u0000${runId}`
    this.ensureRuntimeCapacity(key)
    const seq = (this.runtimeSequences.get(key) ?? 0) + 1
    this.runtimeSequences.set(key, seq)
    this.runtimeTouched.set(key, Date.now())
    const envelope = adaptLegacyAgentEvent({ workspaceId, sessionId, runId, ...legacyEventIdentity(event), seq, event })
    const buffer = this.runtimeBuffers.get(key) ?? new RunEventBuffer()
    buffer.append(envelope)
    buffer.setSnapshot({ workspaceId, sessionId, runId, lastSeq: seq, event: envelope.event })
    this.runtimeBuffers.set(key, buffer)
    for (const listener of this.runtimeEventListeners) listener(envelope)
  }

  getChapterBody(id: string): Promise<string | null> { return getChapterBody(this.requireStore(), id) }
  searchProject(query: string) { return searchProject(this.requireStore(), query) }
  getGraphLayout() { return readGraphLayout(this.requireStore()) }
  saveGraphLayout(layout: Record<string, { x: number; y: number }>) { return writeGraphLayout(this.requireStore(), layout) }
  getWritingTools() { return readWritingTools(this.requireStore()) }
  saveWritingTools(preferences: WritingToolsPreferences) { return writeWritingTools(this.requireStore(), preferences) }
  refreshWorkspace() { return this.getCurrentWorkspace() }
  async exportWorkspace(): Promise<WorkspaceArchive> {
    return exportWorkspaceArchive(this.requireStore(), this.currentPath?.split('/').pop() ?? 'storyfabric')
  }

  async shareWorkspaceArchive(archive: WorkspaceArchive): Promise<void> {
    const result = await Share.canShare()
    if (!result.value) throw new Error('当前设备不支持分享文件')
    const path = `.storyfabric/exports/${archive.fileName}`
    await Filesystem.writeFile({ path, directory: Directory.Cache, data: bytesToBase64(archive.bytes), recursive: true })
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache })
    await Share.share({ title: archive.fileName, text: 'StoryFabric 工作区', files: [uri.uri], dialogTitle: '导出工作区' })
  }
  async exportSession(id: string): Promise<SessionArchive> {
    const session = await this.sessions().load(id)
    if (!session) throw new Error('会话不存在')
    return exportSessionArchive(session)
  }
  async importSession(base64: string, fileName: string): Promise<SessionMeta> {
    const imported = decodeSessionArchive(base64)
    const session = { ...imported, id: genId('sess'), title: imported.title || fileName.replace(/\.storyfabric\.session\.json$/i, '') || '导入会话', updatedAt: Date.now(), archived: false }
    await this.sessions().save(session)
    return { id: session.id, title: session.title, updatedAt: session.updatedAt, messageCount: session.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length, archived: false }
  }
  async shareSessionArchive(archive: SessionArchive): Promise<void> {
    const result = await Share.canShare()
    if (!result.value) throw new Error('当前设备不支持分享文件')
    const path = `.storyfabric/exports/${archive.fileName}`
    await Filesystem.writeFile({ path, directory: Directory.Cache, data: archive.base64, recursive: true })
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache })
    await Share.share({ title: archive.fileName, text: 'StoryFabric 会话', files: [uri.uri], dialogTitle: '导出会话' })
  }
  async importWorkspace(bytes: Uint8Array, fileName: string, target?: WorkspaceImportTarget, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary> {
    const external = target?.parentDir ? parseSafPath(target.parentDir) : null
    if (external?.root) throw new Error('请选择外部父文件夹')
    const root: FileStore = external ? new SafFileStore(makeSafPath(external.treeUri)) : new CapacitorFileStore(WORKSPACE_PREFIX)
    const baseName = (target?.name || fileName.replace(/\.storyfabric\.zip$/i, '')).replace(/[\\/:*?"<>|]/g, '').trim() || '导入工作区'
    throwIfWorkspaceRequestAborted(options?.signal)
    const previousPath = this.currentPath
    let path: string | null = null
    try {
      path = await withAndroidImportLock(async () => {
      throwIfWorkspaceRequestAborted(options?.signal)
      let finalId = baseName
      let suffix = 2
      while (await root.exists(finalId)) finalId = `${baseName}_${suffix++}`
      await root.ensureDir('')
      const targetPath = external ? makeSafPath(external.treeUri, finalId) : normalizeAndroidWorkspacePath(`${WORKSPACE_PREFIX}/${finalId}`)
      let targetReserved = false
      try {
        if (external) await documentTree.mkdir({ treeUri: external.treeUri, root: '', path: finalId, exclusive: true })
        else {
          // The process lock covers suffix allocation here; Filesystem.mkdir reserves the local folder.
          await Filesystem.mkdir({ path: targetPath, directory: Directory.Data, recursive: false })
        }
        targetReserved = true
        const targetStore = workspaceStoreForPath(targetPath)
        await importWorkspaceArchive(targetStore, bytes, { upgradeLegacy: options?.upgradeLegacy === true })
        throwIfWorkspaceRequestAborted(options?.signal)
        await setWorkspaceName(targetStore, baseName)
        throwIfWorkspaceRequestAborted(options?.signal)
        return targetPath
      } catch (error) {
        if (targetReserved) await root.remove(finalId)
        throw error
      }
      })
      throwIfWorkspaceRequestAborted(options?.signal)
      const store = workspaceStoreForPath(path)
      const summary = await loadSummary(store, workspaceFallbackName(path), path)
      throwIfWorkspaceRequestAborted(options?.signal)
      await this.recordRecentWorkspace(path, options?.signal)
      throwIfWorkspaceRequestAborted(options?.signal)
      this.installWorkspace(path, store)
      return summary
    } catch (error) {
      if (path && path !== previousPath) await root.remove(external ? parseSafPath(path)!.root : path.slice(`${WORKSPACE_PREFIX}/`.length))
      throw error
    }
  }

  getDocumentSnapshot(...args: Parameters<StoryFabricApi['getDocumentSnapshot']>): ReturnType<StoryFabricApi['getDocumentSnapshot']> { return getDocumentSnapshot(this.requireStore(), ...args) }
  saveHistoryVersion(...args: Parameters<StoryFabricApi['saveHistoryVersion']>): ReturnType<StoryFabricApi['saveHistoryVersion']> { return saveHistoryVersion(this.requireStore(), ...args) }
  listHistoryVersions(...args: Parameters<StoryFabricApi['listHistoryVersions']>): ReturnType<StoryFabricApi['listHistoryVersions']> { return listHistoryVersions(this.requireStore(), ...args) }
  getHistoryVersion(...args: Parameters<StoryFabricApi['getHistoryVersion']>): ReturnType<StoryFabricApi['getHistoryVersion']> { return getHistoryVersion(this.requireStore(), ...args) }
  updateHistoryVersion(...args: Parameters<StoryFabricApi['updateHistoryVersion']>): ReturnType<StoryFabricApi['updateHistoryVersion']> { return updateHistoryVersion(this.requireStore(), ...args) }
  deleteHistoryVersion(...args: Parameters<StoryFabricApi['deleteHistoryVersion']>): ReturnType<StoryFabricApi['deleteHistoryVersion']> { return deleteHistoryVersion(this.requireStore(), ...args) }
  restoreHistoryVersion(...args: Parameters<StoryFabricApi['restoreHistoryVersion']>): ReturnType<StoryFabricApi['restoreHistoryVersion']> { return restoreHistoryVersion(this.requireStore(), ...args) }

  async saveCharacter(doc: Partial<CharacterDoc>): Promise<CharacterDoc> { return saveCharacter(this.requireStore(), doc) }
  async deleteCharacter(id: string): Promise<void> { return deleteCharacter(this.requireStore(), id) }
  async saveRelationships(list: Relationship[]): Promise<void> { return saveRelationships(this.requireStore(), list) }
  async saveOutlineDoc(doc: Partial<OutlineDoc>, options?: Parameters<StoryFabricApi['saveOutlineDoc']>[1]): Promise<OutlineDoc> { return saveDocument(this.requireStore(), 'outline', doc, options) }
  async deleteOutlineDoc(id: string): Promise<void> { return deleteOutlineDoc(this.requireStore(), id) }
  async saveEvent(doc: Partial<StoryEvent>): Promise<StoryEvent> { return saveEvent(this.requireStore(), doc) }
  async deleteEvent(id: string): Promise<void> { return deleteEvent(this.requireStore(), id) }
  async saveChapter(doc: Partial<ChapterDoc>, options?: Parameters<StoryFabricApi['saveChapter']>[1]): Promise<import('../../../shared/types').ChapterMeta> {
    const saved = await saveDocument(this.requireStore(), 'chapter', doc, options)
    const { content: _content, ...meta } = saved
    void _content
    return meta
  }
  async deleteChapter(id: string): Promise<void> { return deleteChapter(this.requireStore(), id) }
  listVolumes(): Promise<VolumeMeta[]> { return listVolumes(this.requireStore()) }
  saveVolume(input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta> { return saveVolume(this.requireStore(), input) }
  deleteVolume(id: string): Promise<void> { return deleteVolume(this.requireStore(), id) }
  moveChapter(id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void> { return moveChapter(this.requireStore(), id, target) }
  listTrash(): Promise<TrashEntry[]> { return listTrash(this.requireStore()) }
  restoreTrash(id: string): Promise<void> { return restoreFromTrash(this.requireStore(), id) }
  purgeTrash(id: string): Promise<void> { return purgeTrashEntry(this.requireStore(), id) }
  listSettings(): Promise<SettingMeta[]> { return listSettings(this.requireStore()) }
  getSetting(id: string): Promise<SettingDoc | null> { return getSetting(this.requireStore(), id) }
  saveSetting(doc: Partial<SettingDoc>): Promise<SettingDoc> { return saveSetting(this.requireStore(), doc) }
  deleteSetting(id: string): Promise<void> { return deleteSetting(this.requireStore(), id) }
  listNotes(): Promise<NoteMeta[]> { return listNotes(this.requireStore()) }
  getNote(id: string): Promise<NoteDoc | null> { return getNote(this.requireStore(), id) }
  saveNote(doc: Partial<NoteDoc>): Promise<NoteDoc> { return saveNote(this.requireStore(), doc) }
  deleteNote(id: string): Promise<void> { return deleteNote(this.requireStore(), id) }

  async getSettings(): Promise<PublicAppSettings> { return this.withManagedProvider(await this.loadSettings()) }
  async checkAppUpdate(): Promise<import('../../../shared/updates').UpdateCheckResult> {
    const settings = await this.loadSettings()
    return checkForUpdates({ currentVersion: APP_VERSION, platform: 'android', preferences: settings.updatePreferences, fetchImpl: createCapacitorWebFetch(undefined, 10_000) })
  }

  getMemory(scope: MemoryScope): ReturnType<StoryFabricApi['getMemory']> {
    return new MemoryStore(new CapacitorFileStore(), this.requireStore()).read(scope)
  }

  updateMemory(scope: MemoryScope, patch: MemoryUpdate): ReturnType<StoryFabricApi['updateMemory']> {
    return new MemoryStore(new CapacitorFileStore(), this.requireStore()).update(scope, patch)
  }

  async getUsageRecords(): Promise<UsageRecord[]> {
    const records = await Promise.all((await this.allWorkspacePaths()).map(async (path) => {
      try {
        const usage = await new PortableUsageStore(workspaceStoreForPath(path)).list()
        return usage.map((record) => ({ ...record, workspaceId: path }))
      } catch { return [] }
    }))
    return records.flat().sort((a, b) => a.at - b.at)
  }
  async getUsageBuckets(): Promise<import('../../../core/usage/usageArchive').UsageBucket[]> {
    const rows = await Promise.all((await this.allWorkspacePaths()).map(async (path) => {
      try { return (await new PortableUsageStore(workspaceStoreForPath(path)).listBuckets()).map((item) => ({ ...item, workspaceId: path })) }
      catch { return [] }
    }))
    return rows.flat().sort((a, b) => a.hourStart - b.hourStart)
  }
  async getWritingDays(): Promise<Array<import('../../../core/usage/writingStats').WritingDay & { workspaceId: string }>> {
    const rows = await Promise.all((await this.allWorkspacePaths()).map(async (path) => {
      try { return (await listWritingDays(workspaceStoreForPath(path))).map((day) => ({ ...day, workspaceId: path })) }
      catch { return [] }
    }))
    return rows.flat()
  }

  async updateSettings(patch: SettingsPatch): Promise<PublicAppSettings> {
    return withAndroidSettingsLock(async () => {
      await this.loadSettingsFromPreferences()
      this.settings = this.normalizeSettings({ ...this.settings, ...patch })
      await this.saveSettings()
      return this.withManagedProvider(this.settings)
    })
  }

  async saveProvider(input: ProviderInput): Promise<PublicAppSettings> {
    return withAndroidSettingsLock(async () => {
      await this.loadSettingsFromPreferences()
      const id = input.id ?? `prov_${Date.now().toString(36)}`
      if (id === TRAILBLAZER_PROVIDER_ID) {
        const scope = await androidCloudAccount.getPreferenceScope().catch(() => undefined)
        const modelSettings = pruneModelSettings(input.models, input.modelSettings ?? {})
        const preferences: ManagedProviderPreferences = {
          models: [...input.models], modelSettings,
          ...(scope ? { modelScope: scope } : {})
        }
        await this.saveManagedPreferences(preferences)
        this.managedModelsCache = scope ? { scope, models: [...input.models] } : undefined
        return this.withManagedProvider(this.settings)
      }
      const previous = this.settings.providers.find((p) => p.id === id)
      this.settings = {
        ...this.settings,
        providers: [...this.settings.providers.filter((p) => p.id !== id), { id, name: input.name, protocol: input.protocol, baseUrl: input.baseUrl, models: input.models, hasKey: input.apiKey ? true : Boolean(previous?.hasKey), keyPreview: input.apiKey ? keyPreview(input.apiKey) : previous?.keyPreview, modelSettings: pruneModelSettings(input.models, input.modelSettings ?? previous?.modelSettings) }]
      }
      if (input.apiKey) await SecureStorage.setItem(this.keyName(id), input.apiKey)
      await this.saveSettings()
      return this.withManagedProvider(this.settings)
    })
  }

  async deleteProvider(id: string): Promise<PublicAppSettings> {
    return withAndroidSettingsLock(async () => {
      await this.loadSettingsFromPreferences()
      if (id === TRAILBLAZER_PROVIDER_ID) return this.withManagedProvider(this.settings)
      this.settings = {
        ...this.settings,
        providers: this.settings.providers.filter((p) => p.id !== id),
        defaultChatModel: this.settings.defaultChatModel?.providerId === id ? undefined : this.settings.defaultChatModel
      }
      try { await SecureStorage.removeItem(this.keyName(id)) } catch { /* no-op */ }
      await this.saveSettings()
      return this.withManagedProvider(this.settings)
    })
  }

  private async providerInput(input: FetchModelsInput): Promise<{ protocol: FetchModelsInput['protocol']; baseUrl: string; apiKey: string }> {
    if (!input.providerId) return { protocol: input.protocol, baseUrl: input.baseUrl, apiKey: input.apiKey ?? '' }
    const settings = await this.loadSettings()
    const provider = settings.providers.find((item) => item.id === input.providerId)
    if (!provider) throw new Error('供应商不存在')
    return {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: input.apiKey ?? await this.keyOf(provider.id)
    }
  }

  async fetchModels(input: FetchModelsInput): Promise<string[]> {
    if (input.providerId === TRAILBLAZER_PROVIDER_ID) return androidCloudAccount.getModels(input.protocol)
    const provider = await this.providerInput(input)
    return fetchProviderModels(provider.protocol, provider.baseUrl, provider.apiKey, { fetcher: createCapacitorWebFetch() })
  }
  async agentRun(req: RunAgentRequest): Promise<{ sessionId: string; runId: string; goalId?: string; status?: GoalRun['status']; planVersion?: number }> {
    if (!this.agent) throw new Error('尚未打开工作区')
    return this.agent.run(req)
  }
  async compressSessionContext(sessionId: string, providerId: string, model: string): Promise<ChatSession> {
    if (!this.agent) throw new Error('尚未打开工作区')
    return this.agent.compressSessionContext(sessionId, providerId, model)
  }
  agentConfirm(sessionId: string, changeId: string, approved: boolean, decision?: Parameters<StoryFabricApi['agentConfirm']>[3]): Promise<void> { this.agent?.confirmChange(changeId, approved, sessionId, decision); return Promise.resolve() }
  agentAbort(sessionId: string): Promise<void> { this.agent?.abort(sessionId); return Promise.resolve() }
  async agentAnswerQuestion(answer: AgentQuestionAnswer): Promise<void> {
    if (!this.agent) throw new Error('尚未打开工作区')
    await this.agent.answerQuestion(answer)
  }
  async agentResolveSkillCandidate(candidateId: string, action: SkillCandidateAction): Promise<void> {
    if (!this.agent) throw new Error('尚未打开工作区')
    await this.agent.resolveSkillCandidate(candidateId, action)
  }

  listGoals(): Promise<GoalRun[]> { return new GoalStore(this.requireStore()).list(this.currentPath ?? '') }
  async getGoal(id: string): Promise<GoalRun | null> {
    const goal = await new GoalStore(this.requireStore()).get(id)
    if (!goal) return null
    if (goal.workspaceId !== (this.currentPath ?? '')) throw new Error('目标不属于当前工作区')
    return goal
  }
  private async goalModel(): Promise<{ providerId: string; model: string }> {
    const settings = await this.getSettings()
    const preferred = settings.defaultChatModel
    if (preferred && settings.providers.some((provider) => provider.id === preferred.providerId && provider.models.includes(preferred.model) && (provider.hasKey || provider.managed === 'trailblazer' && provider.active))) return preferred
    const provider = settings.providers.find((item) => item.models.length > 0 && (item.hasKey || item.managed === 'trailblazer' && item.active))
    if (!provider) throw new Error('请先配置可用的供应商和模型')
    return { providerId: provider.id, model: provider.models[0] }
  }
  async continueGoal(id: string): Promise<{ goalId: string; runId?: string; status?: GoalRun['status'] }> {
    const goal = await new GoalStore(this.requireStore()).assertWorkspace(id, this.currentPath ?? '')
    const model = await this.goalModel()
    const result = await this.agentRun({ mode: 'goal', goalRunId: goal.id, message: goal.goal, sessionId: goal.sessionId, approvalPolicy: goal.approvalPolicy, ...model })
    if (!result.goalId) throw new Error('目标运行未返回目标 ID')
    return { ...result, goalId: result.goalId }
  }
  async stopGoal(id: string): Promise<void> {
    const goal = await new GoalStore(this.requireStore()).assertWorkspace(id, this.currentPath ?? '')
    this.agentAbort(goal.sessionId)
  }
  async replanGoal(id: string): Promise<{ goalId: string; planVersion?: number; status?: GoalRun['status'] }> {
    const goal = await new GoalStore(this.requireStore()).assertWorkspace(id, this.currentPath ?? '')
    const model = await this.goalModel()
    const result = await this.agentRun({ mode: 'goal', goalAction: 'replan', goalRunId: goal.id, message: goal.goal, sessionId: goal.sessionId, approvalPolicy: goal.approvalPolicy, ...model })
    if (!result.goalId) throw new Error('目标运行未返回目标 ID')
    return { ...result, goalId: result.goalId }
  }

  private sessions(): CoreSessionStore { return new CoreSessionStore(this.requireStore()) }
  listSessions(): Promise<SessionMeta[]> { return this.sessions().list() }
  async createSession(): Promise<ChatSession> {
    const session = await this.sessions().create()
    await this.loadSettingsFromPreferences()
    session.creativePreferences = creativePreferencesFromOrchestrationDefaults(this.settings.orchestrationDefaults)
    await this.sessions().save(session)
    return session
  }
  loadSession(id: string): Promise<ChatSession | null> { return this.sessions().load(id) }
  deleteSession(id: string): Promise<void> {
    if (this.agent?.getActiveRunId(id)) return Promise.reject(new Error('会话正在运行，请先停止运行后再删除'))
    return this.sessions().delete(id)
  }
  async updateSession(id: string, patch: Parameters<StoryFabricApi['updateSession']>[1]): Promise<void> { if (!(await this.sessions().updateMeta(id, patch))) throw new Error('会话不存在') }
  async updateSessionModelPreference(id: string, value: import('../../../shared/types').SessionModelPreference): Promise<void> { if (!(await this.sessions().updateModelPreference(id, value))) throw new Error('会话不存在') }
  onAgentEvent(cb: (envelope: AgentEventEnvelope) => void): () => void { this.eventListeners.add(cb); return () => this.eventListeners.delete(cb) }
  onRuntimeAgentEvent(cb: (envelope: RuntimeAgentEventEnvelope) => void): () => void { this.runtimeEventListeners.add(cb); return () => this.runtimeEventListeners.delete(cb) }
  recoverRunEvents(runId: string, afterSeq = 0): Promise<RunReplay> {
    const key = `${this.currentPath ?? 'android'}\u0000${runId}`
    return Promise.resolve((this.runtimeBuffers.get(key) ?? new RunEventBuffer()).replay(afterSeq))
  }

}

let instance: AndroidPlatformApi | null = null
export function getAndroidApi(): StoryFabricApi {
  if (!instance) instance = new AndroidPlatformApi()
  return instance
}
