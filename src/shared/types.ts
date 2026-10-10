/** StoryFabric 共享领域类型（主进程 / 渲染进程共用） */

import type { RequestContextUsage, RuleApplicationEvent, SkillApplicationEvent, ToolReceipt } from './agentEvidence'
import type { AgentQuestion, PlanningGate, SkillCandidate } from './agentQuestions'

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
  writeRevision?: import('./documentHistory').WriteRevision
  updatedAt?: string
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

export type ChapterStatus = 'draft' | 'revised' | 'body' | 'final'

export interface ChapterMeta {
  id: string
  writeRevision?: import('./documentHistory').WriteRevision
  updatedAt?: string
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
  /** Short line shown beside the title in the tree. */
  summary?: string
  category: SettingCategory
  tags: string[]
  /** Child tag name -> parent tag name. Other tags belong directly to the setting. */
  tagParents?: Record<string, string>
  /** Details keyed by a tag name from tags. */
  tagDetails?: Record<string, { summary?: string; content?: string }>
  parentId?: string
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

import type { CreativePreferences, OrchestrationPreferences } from './creative'
import type { AgentGenerationPreferences } from './agentGeneration'

/* ---------------- 应用设置 ---------------- */

export type Protocol = 'openai' | 'anthropic' | 'gemini'

export interface ModelRef {
  providerId: string
  model: string
}

export interface AppSettings {
  /** 老版本设置缺失时迁移为默认的官网和 GitHub 更新源。 */
  updatePreferences?: import('./updates').UpdatePreferences
  providers: ProviderStored[]
  /** 本地保存的官方 Trailblazer 供应商模型偏好；认证配置由账户中心托管。 */
  trailblazerProvider: ManagedProviderPreferences
  defaultChatModel?: ModelRef
  /** 默认的智能体编排计划；会话发送时从这里读取阶段、模型和预算。 */
  orchestrationDefaults: OrchestrationPreferences
  /** 面向产品的智能体生成偏好，不属于单个模型的供应商参数。 */
  agentGeneration: AgentGenerationPreferences
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
  /** 会话窗口字号（px），只作用于聊天区域 */
  chatFontSize: number
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
  authentication?: 'custom-key' | 'trailblazer-session'
  keyPreview?: string
  /** 系统密钥不可用时标记为明文降级，提示用户风险。 */
  keyStorage?: 'encrypted' | 'plain' | 'none'
  modelSettings: Record<string, ModelSettings>
  /** 固定的官方托管供应商，不能删除或编辑连接配置。 */
  managed?: 'trailblazer'
  /** 只有完成 Trailblazer 登录后才可发起模型请求。 */
  active?: boolean
}

export interface PublicAppSettings extends Omit<AppSettings, 'providers' | 'trailblazerProvider'> {
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

export interface ManagedProviderPreferences {
  models: string[]
  modelSettings: Record<string, ModelSettings>
  /** Hash of the issuer, resource, subject and group that own this model list. */
  modelScope?: string
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
  /** Gemini thought signature required when replaying a thinking function call. */
  thoughtSignature?: string
}

/** Attached to the final assistant message of a run and saved with the session. */
export interface RunActivitySummary {
  skills: Array<{ packageId: string; skillId: string; version: string; stages: string[] }>
  tools: Array<{ name: string; count: number; failed: number }>
  rules: Array<{ id: string; source: string; target: string; key: string }>
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
  /** 普通模式专用智能体的可见运行身份。 */
  agentIdentity?: { id: 'polish' | 'anti-ai'; label: string; model: string }
  /** Evidence of skills, tools and rules used to produce this completed reply. */
  runActivity?: RunActivitySummary
}

/** 可持久化的编排运行摘要；只保存候选产物，不代表已写回工作区。 */
export interface OrchestrationRunRecord {
  runId: string
  /** 本次执行由哪个非终态 checkpoint 恢复；新运行仍使用新的 runId。 */
  resumedFromRunId?: string
  /** 原始用户目标；旧 checkpoint 可能尚无此字段。 */
  goal?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused_budget'
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
  /** 本次编排的总预算快照，供会话重新打开后继续展示调用量。 */
  budget?: AgentBudgetSnapshot
  toolReceipts?: ToolReceipt[]
  requestContexts?: RequestContextUsage[]
  skillEvents?: SkillApplicationEvent[]
  ruleEvents?: RuleApplicationEvent[]
  error?: string
  currentStage?: string
  waitingQuestion?: AgentQuestion
  skillCandidates?: SkillCandidate[]
  planningGate?: PlanningGate
  pendingChange?: PendingChange
  errorCode?: string
  recoverable?: boolean
  recoveryHint?: string
  lastToolReceipt?: ToolReceipt
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
  /** 受控的会话目录名；旧 JSON 会话迁移后补齐。 */
  storageDir?: string
  createdAt: number
  updatedAt: number
  archived: boolean
  messages: ChatMessage[]
  /** 本会话的智能体写入审批策略；旧会话缺省按严格审批处理。 */
  approvalPolicy?: ApprovalPolicy
  modelPreferences?: SessionModelPreference[]
  /** 自动压缩后的较早对话摘要；仅用于模型请求，不替换界面历史。 */
  contextSummary?: string
  /** 摘要覆盖到的最后一条消息 id。 */
  contextSummaryThrough?: string
  contextSummaryUpdatedAt?: number
  /** 本会话的创作模式与扩展选择；缺省时按基础模式读取。 */
  creativePreferences?: CreativePreferences
  waitingQuestion?: AgentQuestion
  skillCandidates?: SkillCandidate[]
  planningGate?: PlanningGate
  /** 严格审批等待中的写入；刷新后仍能定位到会话。 */
  pendingChange?: PendingChange
  /** 最近的编排候选运行，供刷新后查看各阶段结果。 */
  orchestrationRuns?: OrchestrationRunRecord[]
}

/** @引用：显式附带的项目实体 */
export interface Attachment {
  kind: EntityKind
  id: string
  label: string
  purpose?: 'chapter-text-candidate' | 'chapter-polish-candidate' | 'chapter-de-ai-candidate'
}

export interface RunAgentRequest {
  sessionId?: string
  message: string
  providerId: string
  model: string
  /** 本次对话使用的联网搜索服务。缺省时关闭。 */
  webSearchMode?: 'off' | 'auto' | 'native' | 'free' | 'self-hosted'
  attachments?: Attachment[]
  files?: MessageFile[]
  reasoning?: ReasoningLevel
  clientRunId?: string
  /** 本次运行的创作模式；缺省时必须按基础模式处理。 */
  creative?: CreativePreferences
  /** 缺省时回落为一般模式。 */
  mode?: AgentMode
  /** 继续目标时绑定已有目标运行。 */
  goalRunId?: string
  /** 继续目标或重新生成任务计划。 */
  goalAction?: 'continue' | 'replan'
  /** 本次运行冻结的审批策略；缺省时回落为严格审批。 */
  approvalPolicy?: ApprovalPolicy
  /** 从同一会话中指定的非终态编排 checkpoint 继续；不会重复执行已完成阶段。 */
  resumeOrchestrationRunId?: string
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
  /** Requires an explicit human choice whether to retain a long-term version. */
  historyEligible?: boolean
  historyRequired?: boolean
  /** 目标运行所属身份；普通对话缺省。 */
  goalId?: string
  goalTaskId?: string
  mutationKind?: 'create' | 'update' | 'move' | 'restore' | 'delete'
  sessionId?: string
  runId?: string
  stageId?: string
}

/** 已落盘变更的轻量身份；避免在运行事件中重复发送完整文档正文。 */
export interface AppliedChange {
  entityKind: EntityKind | 'relationship'
  entityId: string
}

export type AgentMode = 'normal' | 'orchestration' | 'goal' | 'inspiration'
export type ApprovalPolicy = 'strict' | 'delete-confirm' | 'auto'
export type GoalStatus = 'planning' | 'running' | 'awaiting-approval' | 'validating' | 'completed' | 'needs-attention' | 'cancelled'
export type GoalTaskStatus = 'pending' | 'running' | 'awaiting-approval' | 'validating' | 'completed' | 'failed' | 'skipped'

export interface GoalTask {
  id: string
  title: string
  instructions: string
  acceptanceCriteria: string[]
  dependsOn: string[]
  status: GoalTaskStatus
  attempts: number
  resultSummary?: string
  validationReason?: string
}

export interface GoalRun {
  id: string
  workspaceId: string
  sessionId: string
  goal: string
  status: GoalStatus
  planVersion: number
  tasks: GoalTask[]
  approvalPolicy: ApprovalPolicy
  createdAt: number
  updatedAt: number
  completedReason?: string
  needsAttentionReason?: string
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
  | { type: 'budget'; snapshot: AgentBudgetSnapshot; goalId?: string }
  | { type: 'tool-done'; callId: string; ok: boolean; resultPreview: string }
  | { type: 'pending-change'; change: PendingChange }
  | { type: 'change-applied'; changeId: string; approved: boolean }
  | { type: 'change-result'; changeId: string; status: 'applied' | 'rejected' | 'conflict' | 'failed'; message: string; appliedChange?: AppliedChange }
  | { type: 'goal-plan'; goal: GoalRun }
  | { type: 'goal-task'; goalId: string; task: GoalTask }
  | { type: 'goal-validation'; goalId: string; taskId: string; passed: boolean; reason: string }
  | { type: 'approval-policy'; policy: ApprovalPolicy; goalId?: string }
  | { type: 'request-context'; usage: RequestContextUsage }
  | { type: 'tool-receipt'; receipt: ToolReceipt }
  | { type: 'skill-activity'; activity: SkillApplicationEvent }
  | { type: 'rule-activity'; activity: RuleApplicationEvent }
  | { type: 'run-paused'; reason: 'budget' | 'cancelled' | 'error'; message: string; stageId?: string }
  | { type: 'agent-question'; question: AgentQuestion }
  | { type: 'skill-candidate'; candidate: SkillCandidate }
  | { type: 'waiting-user'; questionId: string; reason?: string; planningGate?: PlanningGate }
  | { type: 'waiting-user'; candidateId: string; reason?: string; planningGate?: PlanningGate }
  | { type: 'context-compression-start'; beforeTokens: number; contextTokens: number }
  | { type: 'context-compressed'; beforeTokens: number; afterTokens: number; summarizedMessages: number; throughMessageId: string; summaryUpdatedAt: number; summary?: string }
  | { type: 'error'; message: string; stageId?: string; code?: string; recoverable?: boolean }
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
  /** 所属项目的工作区路径或服务端工作区 ID；旧全局记录可能缺失。 */
  workspaceId?: string
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
  purpose?: 'basic' | 'stage' | 'child' | 'compression' | 'retry' | 'goal-plan' | 'goal-task' | 'goal-validation'
  attempt?: number
  status?: 'completed' | 'failed' | 'cancelled' | 'missing'
  usageSource?: 'actual' | 'estimated' | 'missing'
}

/** 防止模型进入病态循环的安全上限；正常批量改稿远低于此值。 */
export const MAX_TOOL_ROUNDS = 100
