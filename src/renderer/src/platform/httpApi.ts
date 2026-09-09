import type { AgentEventEnvelope, StoryFabricApi, WorkspaceImportTarget } from '../../../shared/api'
import type { ChapterBox, ChapterDoc, ChatSession, CharacterDoc, NoteDoc, OutlineDoc, Relationship, RunAgentRequest, SettingDoc, StoryEvent, VolumeMeta, WorkspaceListItem, WorkspaceSummary } from '../../../shared/types'
import type { WorkspaceArchive } from '../../../core/workspace/archive'

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type HttpAuth = { kind: 'cookie' } | { kind: 'bearer'; token: string }

export class WebAuthRequiredError extends Error {
  constructor() { super('需要登录'); this.name = 'WebAuthRequiredError' }
}

interface RpcResponse<T> { result?: T; error?: string }

export class HttpPlatformApi implements StoryFabricApi {
  private readonly auth: HttpAuth

  constructor(private readonly fetcher: FetchLike = fetch, private readonly baseUrl = '', auth: HttpAuth = { kind: 'cookie' }) {
    this.auth = auth
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.auth.kind === 'bearer' ? { authorization: `Bearer ${this.auth.token}`, ...extra } : extra
  }

  private async responseError<T>(response: Response): Promise<never> {
    let payload: RpcResponse<T> = {}
    try { payload = await response.json() as RpcResponse<T> } catch { /* status below */ }
    if (response.status === 401) throw new WebAuthRequiredError()
    throw new Error(payload.error || `请求失败 HTTP ${response.status}`)
  }

  private async rpc<T>(method: string, args: unknown[] = []): Promise<T> {
    const init: RequestInit = { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ method, args }) }
    if (this.auth.kind === 'cookie') init.credentials = 'include'
    const response = await this.fetcher(`${this.baseUrl}/api/rpc`, init)
    if (!response.ok) return this.responseError<T>(response)
    return (await response.json() as RpcResponse<T>).result as T
  }

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = this.headers({ ...(init.headers as Record<string, string> | undefined) })
    const request: RequestInit = { ...init, headers }
    if (this.auth.kind === 'cookie') request.credentials = 'include'
    const response = await this.fetcher(`${this.baseUrl}${path}`, request)
    if (!response.ok) return this.responseError<T>(response)
    return response.json() as Promise<T>
  }

  pickFolder(): Promise<string | null> { return Promise.resolve(null) }
  getDefaultWorkspaceDir(): Promise<string> { return Promise.resolve('') }
  listWorkspaces(): Promise<WorkspaceListItem[]> { return this.rest('/api/workspaces') }
  async createWorkspace(_parentDir: string, name: string): Promise<string> { return (await this.rest<WorkspaceSummary>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }), headers: { 'content-type': 'application/json' } })).path }
  openWorkspace(path: string): Promise<WorkspaceSummary> { return this.rest(`/api/workspaces/${encodeURIComponent(path)}/open`, { method: 'POST' }) }
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
  async importWorkspace(bytes: Uint8Array, fileName: string, target?: WorkspaceImportTarget): Promise<WorkspaceSummary> {
    const headers = this.headers({ 'content-type': 'application/zip' })
    const name = target?.name || fileName.replace(/\.storyfabric\.zip$/i, '')
    if (name) headers['x-storyfabric-workspace-name'] = encodeURIComponent(name)
    return this.rest('/api/workspaces/import', { method: 'POST', headers, body: bytes.slice().buffer as ArrayBuffer })
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
  agentRun(req: RunAgentRequest): Promise<{ sessionId: string }> { return this.rpc('agentRun', [req]) }
  agentConfirm(changeId: string, approved: boolean): Promise<void> { return this.rpc('agentConfirm', [changeId, approved]) }
  agentAbort(sessionId: string): Promise<void> { return this.rpc('agentAbort', [sessionId]) }
  listSessions(): Promise<import('../../../shared/types').SessionMeta[]> { return this.rpc('listSessions') }
  createSession(): Promise<ChatSession> { return this.rpc('createSession') }
  loadSession(id: string): Promise<ChatSession | null> { return this.rpc('loadSession', [id]) }
  deleteSession(id: string): Promise<void> { return this.rpc('deleteSession', [id]) }
  updateSession(id: string, patch: { title?: string; archived?: boolean }): Promise<void> { return this.rpc('updateSession', [id, patch]) }

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
}
