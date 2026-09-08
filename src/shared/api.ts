/** 渲染进程可调用的完整 API 面（preload 实现它，renderer 通过 window.api 使用） */
import type {
  AgentEvent,
  ChapterBox,
  ChapterDoc,
  ChapterMeta,
  CharacterDoc,
  ChatSession,
  OutlineDoc,
  Protocol,
  PublicAppSettings,
  Relationship,
  RunAgentRequest,
  SearchHit,
  SessionMeta,
  StoryEvent,
  WorkspaceSummary,
  WorkspaceListItem,
  VolumeMeta,
  TrashEntry,
  SettingDoc,
  SettingMeta,
  NoteDoc,
  NoteMeta
} from './types'
import type { WorkspaceArchive } from '../core/workspace/archive'
import type { SessionArchive } from '../core/workspace/sessionArchive'

export interface AgentEventEnvelope {
  sessionId: string
  event: AgentEvent
}

export type SettingsPatch = Partial<
  Pick<PublicAppSettings, 'theme' | 'defaultChatModel' | 'quickActionModel' | 'customPrompt' | 'showSessionLength'>
>

export interface FetchModelsInput {
  /** 已保存供应商的 id：省略 apiKey 时使用其存储密钥 */
  providerId?: string
  protocol: Protocol
  baseUrl: string
  apiKey?: string
}

export interface WorkspaceImportTarget {
  /** Windows 本地导入的目标父目录；远程/Android 不使用。 */
  parentDir?: string
  /** 用户确认的新工作区名称；缺省时由归档文件名推导。 */
  name?: string
}

export interface StoryFabricApi {
  /* 工作区 */
  pickFolder(): Promise<string | null>
  listWorkspaces(): Promise<WorkspaceListItem[]>
  /** 默认新建位置：系统文档目录 */
  getDefaultWorkspaceDir(): Promise<string>
  createWorkspace(parentDir: string, name: string): Promise<string>
  openWorkspace(path: string): Promise<WorkspaceSummary>
  closeWorkspace(): Promise<void>
  getCurrentWorkspace(): Promise<WorkspaceSummary | null>
  refreshWorkspace(): Promise<WorkspaceSummary | null>
  exportWorkspace(): Promise<WorkspaceArchive>
  /** 在当前平台分享/保存导出的工作区压缩包；Android 使用系统分享面板。 */
  shareWorkspaceArchive?(archive: WorkspaceArchive): Promise<void>
  exportSession(id: string): Promise<SessionArchive>
  importSession(base64: string, fileName: string): Promise<SessionMeta>
  shareSessionArchive?(archive: SessionArchive): Promise<void>
  importWorkspace(bytes: Uint8Array, fileName: string, target?: WorkspaceImportTarget): Promise<WorkspaceSummary>
  getChapterBody(id: string): Promise<string | null>
  searchProject(query: string): Promise<SearchHit[]>
  /** 关系图谱节点坐标（按人物 id） */
  getGraphLayout(): Promise<Record<string, { x: number; y: number }>>
  saveGraphLayout(layout: Record<string, { x: number; y: number }>): Promise<void>

  /* 实体 */
  saveCharacter(doc: Partial<CharacterDoc>): Promise<CharacterDoc>
  deleteCharacter(id: string): Promise<void>
  saveRelationships(list: Relationship[]): Promise<void>
  saveOutlineDoc(doc: Partial<OutlineDoc>): Promise<OutlineDoc>
  deleteOutlineDoc(id: string): Promise<void>
  saveEvent(doc: Partial<StoryEvent>): Promise<StoryEvent>
  deleteEvent(id: string): Promise<void>
  saveChapter(doc: Partial<ChapterDoc>): Promise<ChapterMeta>
  deleteChapter(id: string): Promise<void>
  listVolumes(): Promise<VolumeMeta[]>
  saveVolume(input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta>
  deleteVolume(id: string): Promise<void>
  moveChapter(id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void>
  listTrash(): Promise<TrashEntry[]>
  restoreTrash(id: string): Promise<void>
  purgeTrash(id: string): Promise<void>
  listSettings(): Promise<SettingMeta[]>
  getSetting(id: string): Promise<SettingDoc | null>
  saveSetting(doc: Partial<SettingDoc>): Promise<SettingDoc>
  deleteSetting(id: string): Promise<void>
  listNotes(): Promise<NoteMeta[]>
  getNote(id: string): Promise<NoteDoc | null>
  saveNote(doc: Partial<NoteDoc>): Promise<NoteDoc>
  deleteNote(id: string): Promise<void>

  /* 设置与供应商 */
  getSettings(): Promise<PublicAppSettings>
  updateSettings(patch: SettingsPatch): Promise<PublicAppSettings>
  saveProvider(input: import('./types').ProviderInput): Promise<PublicAppSettings>
  deleteProvider(id: string): Promise<PublicAppSettings>
  fetchModels(input: FetchModelsInput): Promise<string[]>

  /* 智能体 */
  agentRun(req: RunAgentRequest): Promise<{ sessionId: string }>
  agentConfirm(changeId: string, approved: boolean): Promise<void>
  agentAbort(sessionId: string): Promise<void>
  listSessions(): Promise<SessionMeta[]>
  createSession(): Promise<ChatSession>
  loadSession(id: string): Promise<ChatSession | null>
  deleteSession(id: string): Promise<void>
  /** 更新会话元信息：重命名 / 归档 */
  updateSession(id: string, patch: { title?: string; archived?: boolean }): Promise<void>
  onAgentEvent(cb: (envelope: AgentEventEnvelope) => void): () => void
}
