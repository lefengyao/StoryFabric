/** StoryFabric 共享领域类型（主进程 / 渲染进程共用） */

export type EntityKind = 'character' | 'outline' | 'event' | 'chapter' | 'setting' | 'note'

export type CharacterTier = 'primary' | 'secondary'
export type OutlineKind = 'total' | 'chapter'
export type SettingCategory = 'background' | 'other'
export type ChapterBox = 'draft' | 'main' | 'trash'

/* ---------------- 领域文档 ---------------- */

export interface CharacterDoc {
  id: string
  name: string
  aliases: string[]
  role: string
  /** 阵营 / 组织 / 势力分组 */
  faction: string
  gender: string
  age: string
  tags: string[]
  /** 一句话简介 */
  summary: string
  /** 自由 Markdown：外貌、性格、背景、成长弧光…… */
  content: string
  /** 主要角色或次要角色；旧工作区缺失时按 secondary 读取。 */
  tier?: CharacterTier
}

export interface Relationship {
  id: string
  fromId: string
  toId: string
  /** 关系类别：亲属/恋人/朋友/敌对/师徒…… */
  type: string
  /** 关系短语，如「青梅竹马」 */
  label: string
  description: string
  directed: boolean
}

export interface OutlineDoc {
  id: string
  title: string
  order: number
  /** Markdown 正文 */
  content: string
  /** 总纲或章纲；旧工作区缺失时按 total 读取。 */
  kind?: OutlineKind
  chapterId?: string
}

export interface StoryEvent {
  id: string
  title: string
  /** 故事内时间的展示文案，如「第三年·春」 */
  storyTime: string
  /** 时间线排序值（小在前） */
  order: number
  location: string
  tags: string[]
  /** 关联人物 id */
  characterIds: string[]
  /** 因果链：前置/后续事件 id */
  prevIds: string[]
  nextIds: string[]
  content: string
}

export type ChapterStatus = 'draft' | 'revised' | 'final'

export interface ChapterMeta {
  id: string
  title: string
  volume: string
  order: number
  status: ChapterStatus
  wordCount: number
  /** 草稿箱、正文箱或回收站。旧工作区缺失时按 main 读取。 */
  box?: ChapterBox
  /** 新版卷 id；旧工作区由 volume 名称迁移生成。 */
  volumeId?: string
  /** 正文中的术语标注，不改变正文内容。 */
  terms?: TermAnnotation[]
}

export interface ChapterDoc extends ChapterMeta {
  content: string
}

export interface SearchHit {
  kind: EntityKind | 'relationship'
  id: string
  title: string
  snippet: string
}

export interface WorkspaceSummary {
  name: string
  path: string
  characters: CharacterDoc[]
  relationships: Relationship[]
  outline: OutlineDoc[]
  events: StoryEvent[]
  chapters: ChapterMeta[]
  version?: number
  volumes?: VolumeMeta[]
  settings?: SettingMeta[]
  notes?: NoteMeta[]
  trashCount?: number
}

/** Lightweight workspace entry used by workspace pickers. Does not load document bodies. */
export interface WorkspaceListItem {
  name: string
  path: string
  version?: number
  chapterCount: number
  volumeCount: number
  relationshipCount: number
}

export interface VolumeMeta {
  id: string
  title: string
  order: number
}

export interface TermAnnotation {
  term: string
  note?: string
  linkedEntityIds?: string[]
}

export interface SettingDoc {
  id: string
  title: string
  category: SettingCategory
  tags: string[]
  content: string
}

export type SettingMeta = Omit<SettingDoc, 'content'>

export interface NoteDoc {
  id: string
  title: string
  tags: string[]
  pinned: boolean
  createdAt: number
  updatedAt: number
  content: string
}

export type NoteMeta = Omit<NoteDoc, 'content'>

export interface TrashEntry {
  id: string
  kind: EntityKind
  originalPath: string
  deletedAt: number
  title: string
  /** 回收站文件的实际位置。缺失时按 kind/id 推导。 */
  trashPath?: string
}

/* ---------------- 应用设置 ---------------- */

export type Protocol = 'openai' | 'anthropic' | 'gemini'

export interface ModelRef {
  providerId: string
  model: string
}

export interface AppSettings {
  providers: ProviderStored[]
  defaultChatModel?: ModelRef
  quickActionModel?: ModelRef
  theme: 'light' | 'dark' | 'system'
  recentWorkspaces: string[]
  lastWorkspacePath?: string
  /** 用户自定义提示词：附加在内置系统提示词之后 */
  customPrompt: string
  /** 是否在会话界面显示会话长度（消息数与约计字数） */
  showSessionLength: boolean
}

/** 存储态：API Key 以 safeStorage 密文保存 */
export interface ProviderStored {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  apiKeyEncrypted: string
  models: string[]
}

/** 渲染进程可见态：不含密钥明文/密文 */
export interface ProviderPublic {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  models: string[]
  hasKey: boolean
  keyPreview?: string
}

export interface PublicAppSettings extends Omit<AppSettings, 'providers'> {
  providers: ProviderPublic[]
}

/** 新增/编辑供应商时的输入；apiKey 缺省表示沿用旧密钥 */
export interface ProviderInput {
  id?: string
  name: string
  protocol: Protocol
  baseUrl: string
  apiKey?: string
  models: string[]
}

/* ---------------- 智能体会话 ---------------- */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCallData {
  id: string
  name: string
  argsJson: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text?: string
  toolCalls?: ToolCallData[]
  /** role=tool 时对应发起调用的 id */
  toolCallId?: string
  toolName?: string
  isError?: boolean
}

export interface SessionMeta {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  archived: boolean
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  archived: boolean
  messages: ChatMessage[]
}

/** @引用：显式附带的项目实体 */
export interface Attachment {
  kind: EntityKind
  id: string
  label: string
}

export interface RunAgentRequest {
  sessionId?: string
  message: string
  providerId: string
  model: string
  attachments?: Attachment[]
}

/* ---------------- 待确认写变更 ---------------- */

export interface PendingChange {
  id: string
  toolName: string
  entityKind: EntityKind | 'relationship'
  /** 涉及的实体 id（relationship 固定为 "relationships"） */
  entityId: string
  title: string
  beforeText: string
  afterText: string
}

/* ---------------- 智能体流式事件 ---------------- */

export type AgentEvent =
  | { type: 'session'; session: ChatSession }
  | { type: 'text-delta'; messageId: string; delta: string }
  | { type: 'tool-start'; callId: string; name: string; argsJson: string }
  | { type: 'tool-done'; callId: string; ok: boolean; resultPreview: string }
  | { type: 'pending-change'; change: PendingChange }
  | { type: 'change-applied'; changeId: string; approved: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' }

/* ---------------- 工具定义 ---------------- */

export interface ToolDefJson {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const MAX_TOOL_ROUNDS = 10
