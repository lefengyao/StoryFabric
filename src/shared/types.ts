/** StoryFabric 共享领域类型（主进程 / 渲染进程共用） */

export type EntityKind = 'character' | 'outline' | 'event' | 'chapter' | 'setting' | 'note' | 'projectDoc'

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
  /** 所属卷；旧工作区缺失时迁移到第一卷。 */
  volumeId?: string
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
  /** 从当前事件直接分出的分支起点事件 id。 */
  branchIds?: string[]
  /** 当前事件所属分支的起点父事件；主线事件为空。 */
  branchFromId?: string
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
  lastOpenedAt?: string
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
  /** 删除人物时一并保存的关系边，恢复人物时回填。 */
  relatedRelationships?: Relationship[]
  /** 删除事件时保存的目标事件与邻居连接快照，用于无冲突恢复。 */
  eventConnections?: {
    event: StoryEvent
    neighbors: Array<{
      id: string
      before: Pick<StoryEvent, 'prevIds' | 'nextIds' | 'branchIds' | 'branchFromId'>
      after: Pick<StoryEvent, 'prevIds' | 'nextIds' | 'branchIds' | 'branchFromId'>
    }>
  }
}

import type { AgentQuestion, PlanningGate, SkillCandidate } from './agentQuestions'
import type { CreativePreferences, OrchestrationMode } from './creative'

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
  recentWorkspaceOpenedAt: Record<string, string>
  lastWorkspacePath?: string
  /** 用户自定义提示词：附加在内置系统提示词之后 */
  customPrompt: string
  /** 是否在会话界面显示会话长度（消息数与约计字数） */
  showSessionLength: boolean
  /** 智能体回答完成时播放提示音 */
  completionSound: boolean
  /** 浅色主题的强调色基色（#rrggbb） */
  accentColorLight: string
  /** 深色主题的强调色基色（#rrggbb） */
  accentColorDark: string
  /** 编辑器字号（px） */
  editorFontSize: number
  /** 编辑器行距 */
  editorLineHeight: number
  /** 编辑器字体 */
  editorFontFamily: EditorFontFamily
  /** 章节编辑器空闲自动保存间隔（秒）；0 = 关闭 */
  autosaveSeconds: number
  /** 聊天发送快捷键 */
  sendShortcut: SendShortcut
  /** 消息气泡密度 */
  chatDensity: ChatDensity
}

export type EditorFontFamily = 'sans' | 'serif' | 'mono'
export type SendShortcut = 'enter' | 'mod+enter'
export type ChatDensity = 'compact' | 'comfortable' | 'spacious'

/** 存储态：API Key 以 safeStorage 密文保存 */
export interface ProviderStored {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  apiKeyEncrypted: string
  models: string[]
  /** 按模型名的参数覆盖（缺省时取内置档案） */
  modelSettings: Record<string, ModelSettings>
}

/** 推理等级：off 表示不发送推理参数 */
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'
export type ReasoningPreference = 'inherit' | ReasoningLevel

export interface SessionModelPreference {
  providerId: string
  model: string
  reasoning: ReasoningPreference
}

/** 官方思考强度 → 本地等级的映射（用户自填，因无法可靠拉取） */
export interface ReasoningMap {
  /** 请求体里的参数路径，点号分隔：reasoning_effort / thinking.type / generationConfig.thinkingConfig.thinkingBudget */
  path: string
  /** 各等级对应的值（保留用户输入原文，发送时解析） */
  values: Partial<Record<ReasoningLevel, string>>
}

/** 单个模型的参数覆盖 */
export interface ModelSettings {
  /** 是否支持拓展思考（缺省回落到内置档案） */
  reasoningSupport?: boolean
  /** 是否支持图片输入（缺省回落到内置档案） */
  vision?: boolean
  reasoning?: ReasoningLevel
  /** 官方思考强度映射；填了则优先于协议内置形式 */
  reasoningMap?: ReasoningMap
  /** 该模型的上下文窗口（仅记录/展示，协议无此参数） */
  contextTokens?: number
  /** 单次回复输出上限 */
  maxOutputTokens?: number
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
  /** 系统密钥不可用时标记为明文降级，提示用户风险。 */
  keyStorage?: 'encrypted' | 'plain' | 'none'
  modelSettings: Record<string, ModelSettings>
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
  modelSettings?: Record<string, ModelSettings>
}

/* ---------------- 智能体会话 ---------------- */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type MessageFile =
  | { kind: 'image'; id: string; name: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; size: number; base64: string }
  | { kind: 'text'; id: string; name: string; mimeType: string; size: number; text: string }

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
  /** Anthropic 扩展思考块：开启推理后带工具调用继续对话必须原样回传 */
  thinkingBlocks?: unknown[]
  files?: MessageFile[]
  runSettings?: { providerId: string; model: string; reasoning: ReasoningLevel }
}

/** 可持久化的编排运行摘要；只保存候选产物，不代表已写回工作区。 */
export interface OrchestrationRunRecord {
  runId: string
  orchestrationMode?: OrchestrationMode
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  sourceRevision: string | number
  originalText: string
  stages: Array<{ stageId: string; status: string; reason?: string; artifactId?: string }>
  artifacts: Array<{
    id: string
    runId: string
    stageId: string
    agentId: string
    version: number
    kind: string
    status: string
    inputArtifactIds: string[]
    sourceRevisions: Record<string, string | number>
    text?: string
    payload?: unknown
    contentHash: string
    createdAt: number
  }>
  overlay: Record<string, unknown>
  businessText: string
  updatedAt: number
  waitingQuestion?: AgentQuestion
  skillCandidates?: SkillCandidate[]
  planningGate?: PlanningGate
}

export interface AgentBudgetSnapshot {
  maxCalls: number
  maxEstimatedTokens: number
  callsStarted: number
  callsSettled: number
  actualTokens: number
  estimatedTokens: number
  reservedTokens: number
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
  modelPreferences?: SessionModelPreference[]
  /** 自动压缩后的较早对话摘要；仅用于模型请求，不替换界面历史。 */
  contextSummary?: string
  /** 摘要覆盖到的最后一条消息 id。 */
  contextSummaryThrough?: string
  contextSummaryUpdatedAt?: number
  /** 本会话的创作模式与扩展选择；缺省时按基础模式读取。 */
  creativePreferences?: CreativePreferences
  orchestrationMode?: OrchestrationMode
  waitingQuestion?: AgentQuestion
  skillCandidates?: SkillCandidate[]
  planningGate?: PlanningGate
  /** 最近的编排候选运行，供刷新后查看各阶段结果。 */
  orchestrationRuns?: OrchestrationRunRecord[]
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
  files?: MessageFile[]
  reasoning?: ReasoningLevel
  clientRunId?: string
  /** 本次运行的创作模式；缺省时必须按基础模式处理。 */
  creative?: CreativePreferences
  orchestrationMode?: OrchestrationMode
  waitingQuestion?: AgentQuestion
  skillCandidates?: SkillCandidate[]
  planningGate?: PlanningGate
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
  | { type: 'stage-start'; stageId: string }
  | { type: 'stage-complete'; stageId: string; artifactId?: string }
  | { type: 'text-delta'; messageId: string; delta: string }
  | { type: 'tool-start'; callId: string; name: string; argsJson: string }
  | { type: 'tool-args-delta'; callId: string; delta: string }
  | { type: 'tool-preview'; callId: string; preview: string }
  | { type: 'budget'; snapshot: AgentBudgetSnapshot }
  | { type: 'tool-done'; callId: string; ok: boolean; resultPreview: string }
  | { type: 'pending-change'; change: PendingChange }
  | { type: 'change-applied'; changeId: string; approved: boolean }
  | { type: 'change-result'; changeId: string; status: 'applied' | 'rejected' | 'conflict' | 'failed'; message: string }
  | { type: 'agent-question'; question: AgentQuestion }
  | { type: 'skill-candidate'; candidate: SkillCandidate }
  | { type: 'waiting-user'; questionId: string; reason?: string; planningGate?: PlanningGate }
  | { type: 'waiting-user'; candidateId: string; reason?: string; planningGate?: PlanningGate }  | { type: 'context-compression-start'; beforeTokens: number; contextTokens: number }
  | { type: 'context-compressed'; beforeTokens: number; afterTokens: number; summarizedMessages: number; throughMessageId: string; summaryUpdatedAt: number }
  | { type: 'error'; message: string }
  | { type: 'done'; session?: ChatSession }

/* ---------------- 工具定义 ---------------- */

export interface ToolDefJson {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ToolFailureCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_CURSOR'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'SOURCE_CHANGED'
  | 'PROJECT_CHANGED'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'INVALID_EVENT_GRAPH'
  | 'HAS_BRANCHES'
  | 'RESTORE_CONFLICT'
  | 'RESTORE_REQUIRES_PLACEMENT'
  | 'RECOVERY_REQUIRED'

export interface ToolFailure {
  schemaVersion: 2
  error: {
    code: ToolFailureCode
    message: string
    retryable: boolean
    details?: Record<string, unknown>
  }
}

/* ---------------- 模型用量 ---------------- */

/** 一次模型调用的用量记录（三家协议已归一）。 */
export interface UsageRecord {
  /** 调用完成时间（epoch ms） */
  at: number
  providerId: string
  /** 供应商显示名快照：供应商被删除后仍可读 */
  providerName: string
  model: string
  promptTokens: number
  completionTokens: number
  /** 命中提示词缓存的输入 token */
  cachedTokens: number
  /** 为建立缓存而写入的输入 token（仅 Anthropic） */
  cacheWriteTokens: number
  /** 可选的运行归属字段；旧记录缺失时仍可读取。 */
  callId?: string
  runId?: string
  stageId?: string
  agentId?: string
  parentAgentId?: string
  purpose?: 'basic' | 'stage' | 'child' | 'compression' | 'retry'
  attempt?: number
  status?: 'completed' | 'failed' | 'cancelled' | 'missing'
  usageSource?: 'actual' | 'estimated' | 'missing'
}

/** 防止模型进入病态循环的安全上限；正常批量改稿远低于此值。 */
export const MAX_TOOL_ROUNDS = 100

/* ---------------- 远程部署（仅桌面端） ---------------- */

export type DeployStep = 'connect' | 'probe' | 'upload' | 'build' | 'run' | 'healthcheck'
export type DeployStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

/** 单步进度（主进程 → 渲染进程） */
export interface DeployProgress {
  runId: string
  step: DeployStep
  status: DeployStepStatus
  message?: string
  output?: string
  at: number
}

export interface DeployProbeResult {
  os: string
  arch: string
  distro?: string
  isRoot: boolean
  /** `sudo -n true` 成功（免密 sudo） */
  passwordlessSudo: boolean
  dockerVersion?: string
  /** docker 探测失败时的 stderr，用于区分「未安装 / 无权限 / 守护进程未运行」 */
  dockerError?: string
  /** 非 root 且 sudo 不可用时的 stderr（例如密码错误 / 不在 sudoers） */
  sudoError?: string
  portFree: boolean
  portOwner?: string
  /** 服务器上现有 storyfabric 容器的镜像 tag */
  installedImage?: string
}

export interface DeployConnectionInput {
  targetId?: string
  host: string
  port: number
  username: string
  /** 缺省表示使用已保存密码 */
  password?: string
}

export interface DeployTestResult {
  fingerprint: string
  probe: DeployProbeResult
  /** 已保存目标且指纹不一致 */
  fingerprintChanged: boolean
  /** 本地部署包版本，用于和服务器上实际镜像比对 */
  bundleVersion: string
}

export interface DeployRunResult {
  ok: boolean
  version?: string
  url?: string
  accessKey?: string
  failedStep?: DeployStep
  error?: string
}

export interface DeployTargetStored {
  id: string
  label: string
  host: string
  port: number
  username: string
  passwordEncrypted: string
  hostKeyFingerprint: string
  installDir: string
  servicePort: number
  baseImage: string
  bundleSource: 'bundled' | 'url'
  os: 'linux'
  arch?: string
  distro?: string
  dockerVersion?: string
  installedVersion?: string
  /** 部署用户是否为 root（决定后续命令是否加 sudo） */
  isRoot?: boolean
  lastDeployedAt?: number
  lastStatus?: 'ok' | 'failed'
  lastError?: string
}

export type DeployTargetPublic = Omit<DeployTargetStored, 'passwordEncrypted'> & {
  hasPassword: boolean
  /** 密码存储方式：系统级加密 / 降级明文 / 未保存 */
  passwordStorage: 'encrypted' | 'plain' | 'none'
}

export interface DeployTargetInput {
  id?: string
  label: string
  host: string
  port: number
  username: string
  password?: string
  hostKeyFingerprint?: string
  installDir: string
  servicePort: number
  baseImage: string
}
