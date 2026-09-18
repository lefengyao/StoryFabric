import type { AgentEventEnvelope, RuntimeAgentEventEnvelope, StoryFabricApi, WorkspaceImportTarget, WorkspaceRequestOptions } from '../../../shared/api'
import type { ChapterBox, ChapterDoc, ChatSession, CharacterDoc, NoteDoc, OutlineDoc, Relationship, RunAgentRequest, SettingDoc, StoryEvent, VolumeMeta, WorkspaceListItem, WorkspaceSummary } from '../../../shared/types'
import type { WorkspaceArchive } from '../../../core/workspace/archive'
import { normalizeHttpSource } from '../lib/workspaceUiScope'
import type { PlatformCapabilities } from '../../../shared/platformCapabilities'
import type { CreativePackageSummary } from '../../../shared/creative'
import type { RuleLayer } from '../../../core/rules/types'
import type { ContentPackage } from '../../../shared/skillPackage'
import type { RunReplay } from '../../../shared/runEvents'

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type HttpAuth = { kind: 'cookie' } | { kind: 'bearer'; token: string }

export class WebAuthRequiredError extends Error {
  constructor() { super('需要登录'); this.name = 'WebAuthRequiredError' }
}

interface RpcResponse<T> { result?: T; error?: string }
const NON_JSON_RESPONSE_ERROR = '未连接到 StoryFabric 服务：服务端返回了非 JSON 数据'

export class HttpPlatformApi implements StoryFabricApi {
  private readonly auth: HttpAuth

  constructor(private readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis), private readonly baseUrl = '', auth: HttpAuth = { kind: 'cookie' }) {
    this.auth = auth
  }

  getUiSource(): string { return normalizeHttpSource(this.baseUrl) }
  getCapabilities(): Promise<PlatformCapabilities> { return this.rpc('getCapabilities') }
  listCreativePackages(): Promise<CreativePackageSummary[]> { return this.rpc('listCreativePackages') }
  installCreativePackage(input: ContentPackage): Promise<CreativePackageSummary> { return this.rpc('installCreativePackage', [input]) }
  setCreativePackageEnabled(id: string, version: string, enabled: boolean): Promise<CreativePackageSummary> { return this.rpc('setCreativePackageEnabled', [id, version, enabled]) }
  listCreativeRules(): Promise<RuleLayer[]> { return this.rpc('listCreativeRules') }
  saveCreativeRules(layers: RuleLayer[]): Promise<void> { return this.rpc('saveCreativeRules', [layers]) }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.auth.kind === 'bearer' ? { authorization: `Bearer ${this.auth.token}`, ...extra } : extra
  }

  private async responseError<T>(response: Response): Promise<never> {
    let payload: RpcResponse<T> = {}
    try { payload = await response.json() as RpcResponse<T> } catch { /* status below */ }
    if (response.status === 401) throw new WebAuthRequiredError()
    throw new Error(payload.error || `请求失败 HTTP ${response.status}`)
  }

  private async responseJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T
    } catch {
      throw new Error(NON_JSON_RESPONSE_ERROR)
    }
  }

  private async rpc<T>(method: string, args: unknown[] = []): Promise<T> {
    const init: RequestInit = { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ method, args }) }
    if (this.auth.kind === 'cookie') init.credentials = 'include'
    const response = await this.fetcher(`${this.baseUrl}/api/rpc`, init)
    if (!response.ok) return this.responseError<T>(response)
    return (await this.responseJson<RpcResponse<T>>(response)).result as T
  }

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = this.headers({ ...(init.headers as Record<string, string> | undefined) })
    const request: RequestInit = { ...init, headers }
    if (this.auth.kind === 'cookie') request.credentials = 'include'
    const response = await this.fetcher(`${this.baseUrl}${path}`, request)
    if (!response.ok) return this.responseError<T>(response)
    return this.responseJson<T>(response)
  }

  pickFolder(): Promise<string | null> { return Promise.resolve(null) }
  getDefaultWorkspaceDir(): Promise<string> { return Promise.resolve('') }
  listWorkspaces(): Promise<WorkspaceListItem[]> { return this.rest('/api/workspaces') }
  listRecentWorkspaces(): Promise<WorkspaceListItem[]> { return this.rest('/api/workspaces/recent') }
  async createWorkspace(_parentDir: string, name: string): Promise<string> { return (await this.rest<WorkspaceSummary>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }), headers: { 'content-type': 'application/json' } })).path }
  openWorkspace(path: string, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary> { return this.rest(`/api/workspaces/${encodeURIComponent(path)}/open`, { method: 'POST', signal: options?.signal }) }
  openWorkspaceByPath(path: string, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary> {
    const value = path.trim()
    if (!value) return Promise.reject(new Error('请输入工作区路径'))
    return this.rest('/api/workspaces/open-path', { method: 'POST', signal: options?.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: value }) })
  }
  closeWorkspace(): Promise<void> { return this.rpc('closeWorkspace') }
  getCurrentWorkspace(): Promise<WorkspaceSummary | null> { return this.rpc('getCurrentWorkspace') }
  refreshWorkspace(): Promise<WorkspaceSummary | null> { return this.rpc('refreshWorkspace') }
  async exportWorkspace(): Promise<WorkspaceArchive> {
    const current = await this.getCurrentWorkspace()
    if (!current) throw new Error('尚未打开工作区')
    const request: RequestInit = { headers: this.headers() }
    if (this.auth.kind === 'cookie') request.credentials = 'include'
    const response = await this.fetcher(`${this.baseUrl}/api/workspaces/${encodeURIComponent(current.path)}/archive`, request)
    if (!response.ok) return this.responseError<WorkspaceArchive>(response)
    return { fileName: `${current.name}.storyfabric.zip`, bytes: new Uint8Array(await response.arrayBuffer()) }
  }
  async importWorkspace(bytes: Uint8Array, fileName: string, target?: WorkspaceImportTarget, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary> {
    const headers = this.headers({ 'content-type': 'application/zip' })
    const name = target?.name || fileName.replace(/\.storyfabric\.zip$/i, '')
    if (name) headers['x-storyfabric-workspace-name'] = encodeURIComponent(name)
    return this.rest('/api/workspaces/import', { method: 'POST', signal: options?.signal, headers, body: bytes.slice().buffer as ArrayBuffer })
  }
  exportSession(id: string): ReturnType<StoryFabricApi['exportSession']> { return this.rpc('exportSession', [id]) }
  importSession(base64: string, fileName: string): ReturnType<StoryFabricApi['importSession']> { return this.rpc('importSession', [base64, fileName]) }
  getChapterBody(id: string): Promise<string | null> { return this.rpc('getChapterBody', [id]) }
  searchProject(query: string): Promise<import('../../../shared/types').SearchHit[]> { return this.rpc('searchProject', [query]) }
  getGraphLayout(): Promise<Record<string, { x: number; y: number }>> { return this.rpc('getGraphLayout') }
  saveGraphLayout(layout: Record<string, { x: number; y: number }>): Promise<void> { return this.rpc('saveGraphLayout', [layout]) }
  saveCharacter(doc: Partial<CharacterDoc>): Promise<CharacterDoc> { return this.rpc('saveCharacter', [doc]) }
  deleteCharacter(id: string): Promise<void> { return this.rpc('deleteCharacter', [id]) }
  saveRelationships(list: Relationship[]): Promise<void> { return this.rpc('saveRelationships', [list]) }
  saveOutlineDoc(doc: Partial<OutlineDoc>): Promise<OutlineDoc> { return this.rpc('saveOutlineDoc', [doc]) }
  deleteOutlineDoc(id: string): Promise<void> { return this.rpc('deleteOutlineDoc', [id]) }
  saveEvent(doc: Partial<StoryEvent>): Promise<StoryEvent> { return this.rpc('saveEvent', [doc]) }
  deleteEvent(id: string): Promise<void> { return this.rpc('deleteEvent', [id]) }
  saveChapter(doc: Partial<ChapterDoc>): Promise<import('../../../shared/types').ChapterMeta> { return this.rpc('saveChapter', [doc]) }
  deleteChapter(id: string): Promise<void> { return this.rpc('deleteChapter', [id]) }
  listVolumes(): Promise<VolumeMeta[]> { return this.rpc('listVolumes') }
  saveVolume(input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta> { return this.rpc('saveVolume', [input]) }
  deleteVolume(id: string): Promise<void> { return this.rpc('deleteVolume', [id]) }
  moveChapter(id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void> { return this.rpc('moveChapter', [id, target]) }
  listTrash(): Promise<import('../../../shared/types').TrashEntry[]> { return this.rpc('listTrash') }
  restoreTrash(id: string): Promise<void> { return this.rpc('restoreTrash', [id]) }
  purgeTrash(id: string): Promise<void> { return this.rpc('purgeTrash', [id]) }
  listSettings(): Promise<import('../../../shared/types').SettingMeta[]> { return this.rpc('listSettings') }
  getSetting(id: string): Promise<SettingDoc | null> { return this.rpc('getSetting', [id]) }
  saveSetting(doc: Partial<SettingDoc>): Promise<SettingDoc> { return this.rpc('saveSetting', [doc]) }
  deleteSetting(id: string): Promise<void> { return this.rpc('deleteSetting', [id]) }
  listNotes(): Promise<import('../../../shared/types').NoteMeta[]> { return this.rpc('listNotes') }
  getNote(id: string): Promise<NoteDoc | null> { return this.rpc('getNote', [id]) }
  saveNote(doc: Partial<NoteDoc>): Promise<NoteDoc> { return this.rpc('saveNote', [doc]) }
  deleteNote(id: string): Promise<void> { return this.rpc('deleteNote', [id]) }
  getSettings(): Promise<import('../../../shared/types').PublicAppSettings> { return this.rpc('getSettings') }
  updateSettings(patch: Parameters<StoryFabricApi['updateSettings']>[0]): Promise<import('../../../shared/types').PublicAppSettings> { return this.rpc('updateSettings', [patch]) }
  getUsageRecords(): Promise<import('../../../shared/types').UsageRecord[]> { return this.rpc('getUsageRecords') }
  saveProvider(input: Parameters<StoryFabricApi['saveProvider']>[0]): Promise<import('../../../shared/types').PublicAppSettings> { return this.rpc('saveProvider', [input]) }
  deleteProvider(id: string): Promise<import('../../../shared/types').PublicAppSettings> { return this.rpc('deleteProvider', [id]) }
  fetchModels(input: Parameters<StoryFabricApi['fetchModels']>[0]): Promise<string[]> { return this.rpc('fetchModels', [input]) }
  agentRun(req: RunAgentRequest): Promise<{ sessionId: string; runId?: string }> { return this.rpc('agentRun', [req]) }
  agentConfirm(changeId: string, approved: boolean): Promise<void> { return this.rpc('agentConfirm', [changeId, approved]) }
  agentAbort(sessionId: string): Promise<void> { return this.rpc('agentAbort', [sessionId]) }
  listGoals(): Promise<import('../../../shared/types').GoalRun[]> { return this.rpc('listGoals') }
  getGoal(id: string): Promise<import('../../../shared/types').GoalRun | null> { return this.rpc('getGoal', [id]) }
  continueGoal(id: string): Promise<{ goalId: string; runId?: string; status?: import('../../../shared/types').GoalStatus }> { return this.rpc('continueGoal', [id]) }
  stopGoal(id: string): Promise<void> { return this.rpc('stopGoal', [id]) }
  replanGoal(id: string): Promise<{ goalId: string; planVersion?: number; status?: import('../../../shared/types').GoalStatus }> { return this.rpc('replanGoal', [id]) }
  listSessions(): Promise<import('../../../shared/types').SessionMeta[]> { return this.rpc('listSessions') }
  createSession(): Promise<ChatSession> { return this.rpc('createSession') }
  loadSession(id: string): Promise<ChatSession | null> { return this.rpc('loadSession', [id]) }
  deleteSession(id: string): Promise<void> { return this.rpc('deleteSession', [id]) }
  updateSession(id: string, patch: Parameters<StoryFabricApi['updateSession']>[1]): Promise<void> { return this.rpc('updateSession', [id, patch]) }
  updateSessionModelPreference(id: string, value: import('../../../shared/types').SessionModelPreference): Promise<void> { return this.rpc('updateSessionModelPreference', [id, value]) }

  recoverRunEvents(runId: string, afterSeq = 0): Promise<RunReplay> {
    return this.rest(`/api/runs/${encodeURIComponent(runId)}/events?after=${Math.max(0, Math.floor(afterSeq))}`)
  }

  /* 远程部署仅桌面端可用 */
  private unsupported(): never {
    throw new Error('远程部署仅支持桌面端')
  }
  deployTestConnection(): Promise<never> { return this.unsupported() }
  deployInstall(): Promise<never> { return this.unsupported() }
  deployUpdate(): Promise<never> { return this.unsupported() }
  deployCancel(): Promise<never> { return this.unsupported() }
  deployLogs(): Promise<never> { return this.unsupported() }
  deployUninstall(): Promise<never> { return this.unsupported() }
  deployListTargets(): Promise<never> { return this.unsupported() }
  deploySaveTarget(): Promise<never> { return this.unsupported() }
  deployDeleteTarget(): Promise<never> { return this.unsupported() }
  onDeployEvent(): () => void { return () => undefined }

  onAgentEvent(callback: (envelope: AgentEventEnvelope) => void): () => void {
    if (this.auth.kind === 'cookie' && typeof EventSource !== 'undefined') {
      const source = new EventSource(`${this.baseUrl}/api/events`, { withCredentials: true })
      source.onmessage = (event) => { try { callback(JSON.parse(event.data) as AgentEventEnvelope) } catch { /* ignore malformed event */ } }
      return () => source.close()
    }
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    void this.fetcher(`${this.baseUrl}/api/events`, { headers: this.headers(), signal: controller.signal }).then(async (response) => {
      if (!response.ok || !response.body) return
      const streamReader = response.body.getReader()
      reader = streamReader
      const decoder = new TextDecoder()
      let buffer = ''
      while (!controller.signal.aborted) {
        const next = await streamReader.read()
        if (next.done) break
        buffer += decoder.decode(next.value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try { callback(JSON.parse(line.slice(6)) as AgentEventEnvelope) } catch { /* ignore malformed event */ }
        }
      }
    }).catch(() => undefined)
    return () => {
      controller.abort()
      void reader?.cancel().catch(() => undefined)
    }
  }

  onRuntimeAgentEvent(callback: (envelope: RuntimeAgentEventEnvelope) => void): () => void {
    if (this.auth.kind === 'cookie' && typeof EventSource !== 'undefined') {
      const source = new EventSource(`${this.baseUrl}/api/runtime-events`, { withCredentials: true })
      source.onmessage = (event) => { try { callback(JSON.parse(event.data) as RuntimeAgentEventEnvelope) } catch { /* ignore malformed event */ } }
      return () => source.close()
    }
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    void this.fetcher(`${this.baseUrl}/api/runtime-events`, { headers: this.headers(), signal: controller.signal }).then(async (response) => {
      if (!response.ok || !response.body) return
      const streamReader = response.body.getReader()
      reader = streamReader
      const decoder = new TextDecoder()
      let buffer = ''
      while (!controller.signal.aborted) {
        const next = await streamReader.read()
        if (next.done) break
        buffer += decoder.decode(next.value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try { callback(JSON.parse(line.slice(6)) as RuntimeAgentEventEnvelope) } catch { /* ignore malformed event */ }
        }
      }
    }).catch(() => undefined)
    return () => {
      controller.abort()
      void reader?.cancel().catch(() => undefined)
    }
  }
}
