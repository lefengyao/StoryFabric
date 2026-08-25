/** 渲染进程可调用的完整 API 面（preload 实现它，renderer 通过 window.api 使用） */
import type {
  AgentEvent,
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
  WorkspaceSummary
} from './types'

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

export interface StoryFabricApi {
  /* 工作区 */
  pickFolder(): Promise<string | null>
  /** 默认新建位置：系统文档目录 */
  getDefaultWorkspaceDir(): Promise<string>
  createWorkspace(parentDir: string, name: string): Promise<string>
  openWorkspace(path: string): Promise<WorkspaceSummary>
  closeWorkspace(): Promise<void>
  getCurrentWorkspace(): Promise<WorkspaceSummary | null>
  refreshWorkspace(): Promise<WorkspaceSummary | null>
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
  loadSession(id: string): Promise<ChatSession | null>
  deleteSession(id: string): Promise<void>
  /** 更新会话元信息：重命名 / 归档 */
  updateSession(id: string, patch: { title?: string; archived?: boolean }): Promise<void>
  onAgentEvent(cb: (envelope: AgentEventEnvelope) => void): () => void
}
