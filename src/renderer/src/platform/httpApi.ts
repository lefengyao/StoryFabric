import type { AgentEventEnvelope, StoryFabricApi } from '../../../shared/api'
import type { ChapterBox, ChapterDoc, ChatSession, CharacterDoc, NoteDoc, OutlineDoc, Relationship, RunAgentRequest, SettingDoc, StoryEvent, VolumeMeta } from '../../../shared/types'

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class WebAuthRequiredError extends Error {
  constructor() {
    super('需要登录')
    this.name = 'WebAuthRequiredError'
  }
}

interface RpcResponse<T> {
  result?: T
  error?: string
}

export class HttpPlatformApi implements StoryFabricApi {
  constructor(private readonly fetcher: FetchLike = fetch, private readonly baseUrl = '') {}

  private async rpc<T>(method: string, args: unknown[] = []): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}/api/rpc`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args })
    })
    let payload: RpcResponse<T> = {}
    try { payload = await response.json() as RpcResponse<T> } catch { /* use status below */ }
    if (response.status === 401) throw new WebAuthRequiredError()
    if (!response.ok) throw new Error(payload.error || `请求失败 HTTP ${response.status}`)
    return payload.result as T
  }

  pickFolder(): Promise<string | null> { return Promise.resolve(null) }
  getDefaultWorkspaceDir(): Promise<string> { return this.rpc('getDefaultWorkspaceDir') }
  createWorkspace(parentDir: string, name: string): Promise<string> { return this.rpc('createWorkspace', [parentDir, name]) }
  openWorkspace(path: string): Promise<ReturnType<StoryFabricApi['openWorkspace']> extends Promise<infer T> ? T : never> { return this.rpc('openWorkspace', [path]) }
  closeWorkspace(): Promise<void> { return this.rpc('closeWorkspace') }
  getCurrentWorkspace(): ReturnType<StoryFabricApi['getCurrentWorkspace']> { return this.rpc('getCurrentWorkspace') }
  refreshWorkspace(): ReturnType<StoryFabricApi['refreshWorkspace']> { return this.rpc('refreshWorkspace') }
  exportWorkspace(): ReturnType<StoryFabricApi['exportWorkspace']> { return this.rpc('exportWorkspace') }
  exportSession(id: string): ReturnType<StoryFabricApi['exportSession']> { return this.rpc('exportSession', [id]) }
  importSession(base64: string, fileName: string): ReturnType<StoryFabricApi['importSession']> { return this.rpc('importSession', [base64, fileName]) }
  importWorkspace(base64: string, fileName: string): ReturnType<StoryFabricApi['importWorkspace']> { return this.rpc('importWorkspace', [base64, fileName]) }
  getChapterBody(id: string): Promise<string | null> { return this.rpc('getChapterBody', [id]) }
  searchProject(query: string): ReturnType<StoryFabricApi['searchProject']> { return this.rpc('searchProject', [query]) }
  getGraphLayout(): ReturnType<StoryFabricApi['getGraphLayout']> { return this.rpc('getGraphLayout') }
  saveGraphLayout(layout: Record<string, { x: number; y: number }>): Promise<void> { return this.rpc('saveGraphLayout', [layout]) }
  saveCharacter(doc: Partial<CharacterDoc>): Promise<CharacterDoc> { return this.rpc('saveCharacter', [doc]) }
  deleteCharacter(id: string): Promise<void> { return this.rpc('deleteCharacter', [id]) }
  saveRelationships(list: Relationship[]): Promise<void> { return this.rpc('saveRelationships', [list]) }
  saveOutlineDoc(doc: Partial<OutlineDoc>): Promise<OutlineDoc> { return this.rpc('saveOutlineDoc', [doc]) }
  deleteOutlineDoc(id: string): Promise<void> { return this.rpc('deleteOutlineDoc', [id]) }
  saveEvent(doc: Partial<StoryEvent>): Promise<StoryEvent> { return this.rpc('saveEvent', [doc]) }
  deleteEvent(id: string): Promise<void> { return this.rpc('deleteEvent', [id]) }
  saveChapter(doc: Partial<ChapterDoc>): ReturnType<StoryFabricApi['saveChapter']> { return this.rpc('saveChapter', [doc]) }
  deleteChapter(id: string): Promise<void> { return this.rpc('deleteChapter', [id]) }
  listVolumes(): Promise<VolumeMeta[]> { return this.rpc('listVolumes') }
  saveVolume(input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta> { return this.rpc('saveVolume', [input]) }
  deleteVolume(id: string): Promise<void> { return this.rpc('deleteVolume', [id]) }
  moveChapter(id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void> { return this.rpc('moveChapter', [id, target]) }
  listTrash(): ReturnType<StoryFabricApi['listTrash']> { return this.rpc('listTrash') }
  restoreTrash(id: string): Promise<void> { return this.rpc('restoreTrash', [id]) }
  purgeTrash(id: string): Promise<void> { return this.rpc('purgeTrash', [id]) }
  listSettings(): ReturnType<StoryFabricApi['listSettings']> { return this.rpc('listSettings') }
  getSetting(id: string): Promise<SettingDoc | null> { return this.rpc('getSetting', [id]) }
  saveSetting(doc: Partial<SettingDoc>): Promise<SettingDoc> { return this.rpc('saveSetting', [doc]) }
  deleteSetting(id: string): Promise<void> { return this.rpc('deleteSetting', [id]) }
  listNotes(): ReturnType<StoryFabricApi['listNotes']> { return this.rpc('listNotes') }
  getNote(id: string): Promise<NoteDoc | null> { return this.rpc('getNote', [id]) }
  saveNote(doc: Partial<NoteDoc>): Promise<NoteDoc> { return this.rpc('saveNote', [doc]) }
  deleteNote(id: string): Promise<void> { return this.rpc('deleteNote', [id]) }
  getSettings(): ReturnType<StoryFabricApi['getSettings']> { return this.rpc('getSettings') }
  updateSettings(patch: Parameters<StoryFabricApi['updateSettings']>[0]): ReturnType<StoryFabricApi['updateSettings']> { return this.rpc('updateSettings', [patch]) }
  saveProvider(input: Parameters<StoryFabricApi['saveProvider']>[0]): ReturnType<StoryFabricApi['saveProvider']> { return this.rpc('saveProvider', [input]) }
  deleteProvider(id: string): ReturnType<StoryFabricApi['deleteProvider']> { return this.rpc('deleteProvider', [id]) }
  fetchModels(input: Parameters<StoryFabricApi['fetchModels']>[0]): ReturnType<StoryFabricApi['fetchModels']> { return this.rpc('fetchModels', [input]) }
  agentRun(req: RunAgentRequest): Promise<{ sessionId: string }> { return this.rpc('agentRun', [req]) }
  agentConfirm(changeId: string, approved: boolean): Promise<void> { return this.rpc('agentConfirm', [changeId, approved]) }
  agentAbort(sessionId: string): Promise<void> { return this.rpc('agentAbort', [sessionId]) }
  listSessions(): ReturnType<StoryFabricApi['listSessions']> { return this.rpc('listSessions') }
  createSession(): Promise<ChatSession> { return this.rpc('createSession') }
  loadSession(id: string): Promise<ChatSession | null> { return this.rpc('loadSession', [id]) }
  deleteSession(id: string): Promise<void> { return this.rpc('deleteSession', [id]) }
  updateSession(id: string, patch: { title?: string; archived?: boolean }): Promise<void> { return this.rpc('updateSession', [id, patch]) }

  onAgentEvent(callback: (envelope: AgentEventEnvelope) => void): () => void {
    const source = new EventSource(`${this.baseUrl}/api/events`, { withCredentials: true })
    source.onmessage = (event) => {
      try { callback(JSON.parse(event.data) as AgentEventEnvelope) } catch { /* ignore malformed event */ }
    }
    return () => source.close()
  }
}
