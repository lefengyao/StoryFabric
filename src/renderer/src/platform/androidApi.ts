import { Preferences } from '@capacitor/preferences'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { Share } from '@capacitor/share'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { AgentEventEnvelope, StoryFabricApi } from '../../../shared/api'
import type { FetchModelsInput, SettingsPatch } from '../../../shared/api'
import type { WorkspaceArchive } from '../../../core/workspace/archive'
import type { ChapterBox, ChapterDoc, CharacterDoc, ChatSession, NoteDoc, NoteMeta, OutlineDoc, ProviderInput, PublicAppSettings, Relationship, RunAgentRequest, SessionMeta, SettingDoc, SettingMeta, StoryEvent, TrashEntry, VolumeMeta, WorkspaceSummary } from '../../../shared/types'
import { CapacitorFileStore } from './capacitorFileStore'
import { deleteChapter, deleteCharacter, deleteEvent, deleteOutlineDoc, getChapterBody, listChapters, listCharacters, listEvents, listOutline, loadRelationships, saveChapter, saveCharacter, saveEvent, saveOutlineDoc, saveRelationships, searchProject } from '../../../core/workspace/entityStore'
import { initializeWorkspace, loadSummary, readGraphLayout, validateWorkspace, writeGraphLayout } from '../../../core/workspace/workspaceService'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../../../core/workspace/archive'
import { decodeSessionArchive, exportSessionArchive, type SessionArchive } from '../../../core/workspace/sessionArchive'
import { genId } from '../../../core/workspace/entityStore'
import { CoreSessionStore } from '../../../core/workspace/sessionStore'
import { CoreAgentService } from '../../../core/agent/agentLoop'
import { fetchProviderModels, getAdapter } from '../../../core/llm'

const SETTINGS_KEY = 'storyfabric.settings'
const WORKSPACE_PREFIX = 'workspaces'

const DEFAULT_PUBLIC: PublicAppSettings = { providers: [], theme: 'system', recentWorkspaces: [], customPrompt: '', showSessionLength: false }

/** Android 平台 API：应用私有目录工作区，密钥使用 Android Keystore-backed secure storage。 */
export class AndroidPlatformApi implements StoryFabricApi {
  private currentPath: string | null = null
  private currentStore: CapacitorFileStore | null = null
  private settings: PublicAppSettings = { ...DEFAULT_PUBLIC }
  private agent: CoreAgentService | null = null

  private keyName(providerId: string): string { return `provider-api-key:${providerId}` }

  private async keyOf(providerId: string): Promise<string> {
    try { return (await SecureStorage.getItem(this.keyName(providerId))) ?? '' } catch { return '' }
  }

  private async loadSettings(): Promise<PublicAppSettings> {
    const raw = await Preferences.get({ key: SETTINGS_KEY })
    if (!raw.value) return this.settings
    try {
      this.settings = { ...DEFAULT_PUBLIC, ...(JSON.parse(raw.value) as Partial<PublicAppSettings>) }
    } catch {
      this.settings = { ...DEFAULT_PUBLIC }
    }
    return this.settings
  }

  private async saveSettings(): Promise<void> {
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(this.settings) })
  }

  private requireStore(): CapacitorFileStore {
    if (!this.currentStore) throw new Error('尚未打开工作区')
    return this.currentStore
  }

  private async installWorkspace(path: string, store: CapacitorFileStore): Promise<void> {
    this.currentPath = path
    this.currentStore = store
    this.agent = new CoreAgentService({
      store,
      sessions: new CoreSessionStore(store),
      getAdapter,
      settings: async () => {
        const s = await this.loadSettings()
        return { customPrompt: s.customPrompt, providers: await Promise.all(s.providers.map(async (p) => ({ id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, apiKey: await this.keyOf(p.id) }))) }
      },
      emit: (sessionId, event) => this.emitAgentEvent(sessionId, event)
    })
  }

  pickFolder(): Promise<string | null> {
    // Android 首版不伪装系统目录选择器；通过应用内创建工作区进入。
    return Promise.resolve(null)
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const root = new CapacitorFileStore(WORKSPACE_PREFIX)
    const dirs = await root.listDirs('')
    const result: WorkspaceSummary[] = []
    for (const dir of dirs) {
      const path = `${WORKSPACE_PREFIX}/${dir}`
      const store = new CapacitorFileStore(path)
      if (!(await validateWorkspace(store)).ok) continue
      try {
        result.push(await loadSummary(store, dir, path))
      } catch {
        /* 跳过损坏或正在写入中的工作区 */
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  getDefaultWorkspaceDir(): Promise<string> { return Promise.resolve(WORKSPACE_PREFIX) }

  async createWorkspace(_parentDir: string, name: string): Promise<string> {
    const safe = name.replace(/[\\/:*?"<>|]/g, '').trim()
    if (!safe) throw new Error('工作区名称不能为空')
    const path = `${WORKSPACE_PREFIX}/${safe}_${Date.now().toString(36)}`
    const store = new CapacitorFileStore(path)
    if (await store.exists('storyfabric.json')) throw new Error('工作区已存在')
    await initializeWorkspace(store, safe)
    return path
  }

  async openWorkspace(path: string): Promise<WorkspaceSummary> {
    const store = new CapacitorFileStore(path)
    const valid = await validateWorkspace(store)
    if (!valid.ok) throw new Error(valid.reason)
    await this.installWorkspace(path, store)
    await this.loadSettings()
    this.settings = { ...this.settings, recentWorkspaces: [path, ...this.settings.recentWorkspaces.filter((p) => p !== path)].slice(0, 8) }
    this.settings.lastWorkspacePath = path
    await this.saveSettings()
    return loadSummary(store, path.split('/').pop() ?? 'StoryFabric', path)
  }

  async closeWorkspace(): Promise<void> { this.currentPath = null; this.currentStore = null }

  async getCurrentWorkspace(): Promise<WorkspaceSummary | null> {
    if (!this.currentStore || !this.currentPath) {
      await this.loadSettings()
      const path = this.settings.lastWorkspacePath
      if (path) {
        const store = new CapacitorFileStore(path)
        const valid = await validateWorkspace(store)
        if (valid.ok) {
          await this.installWorkspace(path, store)
        }
      }
    }
    if (!this.currentStore || !this.currentPath) return null
    return loadSummary(this.currentStore, this.currentPath.split('/').pop() ?? 'StoryFabric', this.currentPath)
  }

  private eventListeners = new Set<(envelope: AgentEventEnvelope) => void>()
  private emitAgentEvent(sessionId: string, event: AgentEventEnvelope['event']): void { for (const listener of this.eventListeners) listener({ sessionId, event }) }

  getChapterBody(id: string): Promise<string | null> { return getChapterBody(this.requireStore(), id) }
  searchProject(query: string) { return searchProject(this.requireStore(), query) }
  getGraphLayout() { return readGraphLayout(this.requireStore()) }
  saveGraphLayout(layout: Record<string, { x: number; y: number }>) { return writeGraphLayout(this.requireStore(), layout) }
  refreshWorkspace() { return this.getCurrentWorkspace() }
  async exportWorkspace(): Promise<WorkspaceArchive> {
    return exportWorkspaceArchive(this.requireStore(), this.currentPath?.split('/').pop() ?? 'storyfabric')
  }

  async shareWorkspaceArchive(archive: WorkspaceArchive): Promise<void> {
    const result = await Share.canShare()
    if (!result.value) throw new Error('当前设备不支持分享文件')
    const path = `.storyfabric/exports/${archive.fileName}`
    await Filesystem.writeFile({ path, directory: Directory.Cache, data: archive.base64, recursive: true })
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
  async importWorkspace(base64: string, fileName: string): Promise<WorkspaceSummary> {
    const path = `${WORKSPACE_PREFIX}/${fileName.replace(/[\\/:*?"<>|]/g, '').replace(/\.storyfabric\.zip$/i, '') || `import_${Date.now().toString(36)}`}`
    const store = new CapacitorFileStore(path)
    await importWorkspaceArchive(store, base64)
    await this.installWorkspace(path, store)
    await this.loadSettings()
    this.settings = { ...this.settings, recentWorkspaces: [path, ...this.settings.recentWorkspaces.filter((p) => p !== path)].slice(0, 8) }
    this.settings.lastWorkspacePath = path
    await this.saveSettings()
    return loadSummary(store, path.split('/').pop() ?? 'StoryFabric', path)
  }

  async saveCharacter(doc: Partial<CharacterDoc>): Promise<CharacterDoc> { return saveCharacter(this.requireStore(), doc) }
  async deleteCharacter(id: string): Promise<void> { return deleteCharacter(this.requireStore(), id) }
  async saveRelationships(list: Relationship[]): Promise<void> { return saveRelationships(this.requireStore(), list) }
  async saveOutlineDoc(doc: Partial<OutlineDoc>): Promise<OutlineDoc> { return saveOutlineDoc(this.requireStore(), doc) }
  async deleteOutlineDoc(id: string): Promise<void> { return deleteOutlineDoc(this.requireStore(), id) }
  async saveEvent(doc: Partial<StoryEvent>): Promise<StoryEvent> { return saveEvent(this.requireStore(), doc) }
  async deleteEvent(id: string): Promise<void> { return deleteEvent(this.requireStore(), id) }
  async saveChapter(doc: Partial<ChapterDoc>): Promise<import('../../../shared/types').ChapterMeta> {
    const saved = await saveChapter(this.requireStore(), doc)
    const { content: _content, ...meta } = saved
    void _content
    return meta
  }
  async deleteChapter(id: string): Promise<void> { return deleteChapter(this.requireStore(), id) }
  listVolumes(): Promise<VolumeMeta[]> { return import('../../../core/workspace/workspaceService').then(({ listVolumes }) => listVolumes(this.requireStore())) }
  saveVolume(input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta> { return import('../../../core/workspace/workspaceService').then(({ saveVolume }) => saveVolume(this.requireStore(), input)) }
  deleteVolume(id: string): Promise<void> { return import('../../../core/workspace/workspaceService').then(({ deleteVolume }) => deleteVolume(this.requireStore(), id)) }
  moveChapter(id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void> { return import('../../../core/workspace/workspaceService').then(({ moveChapter }) => moveChapter(this.requireStore(), id, target)) }
  listTrash(): Promise<TrashEntry[]> { return import('../../../core/workspace/trash').then(({ listTrash }) => listTrash(this.requireStore())) }
  restoreTrash(id: string): Promise<void> { return import('../../../core/workspace/trash').then(({ restoreFromTrash }) => restoreFromTrash(this.requireStore(), id)) }
  purgeTrash(id: string): Promise<void> { return import('../../../core/workspace/trash').then(({ purgeTrashEntry }) => purgeTrashEntry(this.requireStore(), id)) }
  listSettings(): Promise<SettingMeta[]> { return import('../../../core/workspace/entityStore').then(({ listSettings }) => listSettings(this.requireStore())) }
  getSetting(id: string): Promise<SettingDoc | null> { return import('../../../core/workspace/entityStore').then(({ getSetting }) => getSetting(this.requireStore(), id)) }
  saveSetting(doc: Partial<SettingDoc>): Promise<SettingDoc> { return import('../../../core/workspace/entityStore').then(({ saveSetting }) => saveSetting(this.requireStore(), doc)) }
  deleteSetting(id: string): Promise<void> { return import('../../../core/workspace/entityStore').then(({ deleteSetting }) => deleteSetting(this.requireStore(), id)) }
  listNotes(): Promise<NoteMeta[]> { return import('../../../core/workspace/entityStore').then(({ listNotes }) => listNotes(this.requireStore())) }
  getNote(id: string): Promise<NoteDoc | null> { return import('../../../core/workspace/entityStore').then(({ getNote }) => getNote(this.requireStore(), id)) }
  saveNote(doc: Partial<NoteDoc>): Promise<NoteDoc> { return import('../../../core/workspace/entityStore').then(({ saveNote }) => saveNote(this.requireStore(), doc)) }
  deleteNote(id: string): Promise<void> { return import('../../../core/workspace/entityStore').then(({ deleteNote }) => deleteNote(this.requireStore(), id)) }

  async getSettings(): Promise<PublicAppSettings> { return this.loadSettings() }

  async updateSettings(patch: SettingsPatch): Promise<PublicAppSettings> {
    this.settings = { ...this.settings, ...patch }
    await this.saveSettings()
    return this.settings
  }

  async saveProvider(input: ProviderInput): Promise<PublicAppSettings> {
    const id = input.id ?? `prov_${Date.now().toString(36)}`
    const previous = this.settings.providers.find((p) => p.id === id)
    this.settings.providers = [...this.settings.providers.filter((p) => p.id !== id), { id, name: input.name, protocol: input.protocol, baseUrl: input.baseUrl, models: input.models, hasKey: input.apiKey ? true : Boolean(previous?.hasKey), keyPreview: input.apiKey ? `${input.apiKey.slice(0, 4)}****${input.apiKey.slice(-4)}` : previous?.keyPreview }]
    if (input.apiKey) await SecureStorage.setItem(this.keyName(id), input.apiKey)
    await this.saveSettings()
    return this.settings
  }

  async deleteProvider(id: string): Promise<PublicAppSettings> {
    this.settings.providers = this.settings.providers.filter((p) => p.id !== id)
    try { await SecureStorage.removeItem(this.keyName(id)) } catch { /* no-op */ }
    if (this.settings.defaultChatModel?.providerId === id) this.settings.defaultChatModel = undefined
    if (this.settings.quickActionModel?.providerId === id) this.settings.quickActionModel = undefined
    await this.saveSettings()
    return this.settings
  }

  async fetchModels(input: FetchModelsInput): Promise<string[]> {
    const key = input.apiKey ?? (input.providerId ? await this.keyOf(input.providerId) : '')
    return fetchProviderModels(input.protocol, input.baseUrl, key)
  }
  async agentRun(req: RunAgentRequest): Promise<{ sessionId: string }> {
    if (!this.agent) throw new Error('尚未打开工作区')
    return this.agent.run(req)
  }
  agentConfirm(changeId: string, approved: boolean): Promise<void> { this.agent?.confirmChange(changeId, approved); return Promise.resolve() }
  agentAbort(sessionId: string): Promise<void> { this.agent?.abort(sessionId); return Promise.resolve() }

  private sessions(): CoreSessionStore { return new CoreSessionStore(this.requireStore()) }
  listSessions(): Promise<SessionMeta[]> { return this.sessions().list() }
  async createSession(): Promise<ChatSession> {
    const session = await this.sessions().create()
    await this.sessions().save(session)
    return session
  }
  loadSession(id: string): Promise<ChatSession | null> { return this.sessions().load(id) }
  deleteSession(id: string): Promise<void> { return this.sessions().delete(id) }
  async updateSession(id: string, patch: { title?: string; archived?: boolean }): Promise<void> { if (!(await this.sessions().updateMeta(id, patch))) throw new Error('会话不存在') }
  onAgentEvent(cb: (envelope: AgentEventEnvelope) => void): () => void { this.eventListeners.add(cb); return () => this.eventListeners.delete(cb) }
}

let instance: AndroidPlatformApi | null = null
export function getAndroidApi(): StoryFabricApi {
  if (!instance) instance = new AndroidPlatformApi()
  return instance
}
