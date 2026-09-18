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
  SessionModelPreference,
  StoryEvent,
  WorkspaceSummary,
  WorkspaceListItem,
  VolumeMeta,
  TrashEntry,
  SettingDoc,
  SettingMeta,
  NoteDoc,
  NoteMeta,
  UsageRecord,
  GoalRun
} from './types'
import type { WorkspaceArchive } from '../core/workspace/archive'
import type { SessionArchive } from '../core/workspace/sessionArchive'
import type { RunEventEnvelope } from './agentRuntime'
import type { RunReplay } from './runEvents'
import type { PlatformCapabilities } from './platformCapabilities'
import type { CreativePackageSummary, CreativePreferences } from './creative'
import type { AgentQuestionAnswer, SkillCandidateAction } from './agentQuestions'
import type { RuleLayer } from '../core/rules/types'
import type { ContentPackage } from './skillPackage'

export interface AgentEventEnvelope {
  sessionId: string
  runId?: string
  event: AgentEvent
}

/** 新运行协议的事件外壳；旧 AgentEvent 通过 agentRuntime 的适配器进入此协议。 */
export type RuntimeAgentEventEnvelope = RunEventEnvelope

export type SettingsPatch = Partial<
  Pick<
    PublicAppSettings,
    | 'theme'
    | 'defaultChatModel'
    | 'quickActionModel'
    | 'orchestrationDefaults'
    | 'customPrompt'
    | 'showSessionLength'
    | 'completionSound'
    | 'accentColorLight'
    | 'accentColorDark'
    | 'editorFontSize'
    | 'editorLineHeight'
    | 'editorFontFamily'
    | 'autosaveSeconds'
    | 'sendShortcut'
    | 'chatDensity'
  >
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

export interface WorkspaceRequestOptions {
  signal?: AbortSignal
  /** Electron uses this opaque ID to cancel work already handed to the main process. */
  requestId?: string
}

export function throwIfWorkspaceRequestAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('工作区请求已取消')
  error.name = 'AbortError'
  throw error
}

export interface StoryFabricApi {
  getCapabilities?(): Promise<PlatformCapabilities>
  /** Renderer-only, non-sensitive source identity used for UI state partitioning. */
  getUiSource?(): string
  /* 剪贴板 */
  clipboardReadText?(): Promise<string>
  clipboardWriteText?(text: string): Promise<void>

  /* 工作区 */
  pickFolder(): Promise<string | null>
  listWorkspaces(): Promise<WorkspaceListItem[]>
  listRecentWorkspaces(): Promise<WorkspaceListItem[]>
  /** 默认新建位置：系统文档目录 */
  getDefaultWorkspaceDir(): Promise<string>
  createWorkspace(parentDir: string, name: string): Promise<string>
  openWorkspace(path: string, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary>
  openWorkspaceByPath(path: string, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary>
  closeWorkspace(): Promise<void>
  getCurrentWorkspace(): Promise<WorkspaceSummary | null>
  refreshWorkspace(): Promise<WorkspaceSummary | null>
  exportWorkspace(): Promise<WorkspaceArchive>
  /** 在当前平台分享/保存导出的工作区压缩包；Android 使用系统分享面板。 */
  shareWorkspaceArchive?(archive: WorkspaceArchive): Promise<void>
  exportSession(id: string): Promise<SessionArchive>
  importSession(base64: string, fileName: string): Promise<SessionMeta>
  shareSessionArchive?(archive: SessionArchive): Promise<void>
  importWorkspace(bytes: Uint8Array, fileName: string, target?: WorkspaceImportTarget, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary>
  cancelWorkspaceRequest?(requestId: string): Promise<void>
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
  /** 模型用量记录（最近若干次调用，按时间升序） */
  getUsageRecords(): Promise<UsageRecord[]>
  listCreativePackages(): Promise<CreativePackageSummary[]>
  installCreativePackage(input: ContentPackage): Promise<CreativePackageSummary>
  setCreativePackageEnabled(id: string, version: string, enabled: boolean): Promise<CreativePackageSummary>
  listCreativeRules(): Promise<RuleLayer[]>
  saveCreativeRules(layers: RuleLayer[]): Promise<void>
  saveProvider(input: import('./types').ProviderInput): Promise<PublicAppSettings>
  deleteProvider(id: string): Promise<PublicAppSettings>
  fetchModels(input: FetchModelsInput): Promise<string[]>

  /* 智能体 */
  agentRun(req: RunAgentRequest): Promise<{ sessionId: string; runId?: string; goalId?: string; status?: GoalRun['status']; planVersion?: number }>
  listGoals(): Promise<GoalRun[]>
  getGoal(id: string): Promise<GoalRun | null>
  continueGoal(id: string): Promise<{ goalId: string; runId?: string; status?: GoalRun['status'] }>
  stopGoal(id: string): Promise<void>
  replanGoal(id: string): Promise<{ goalId: string; planVersion?: number; status?: GoalRun['status'] }>
  agentConfirm(changeId: string, approved: boolean): Promise<void>
  agentAbort(sessionId: string): Promise<void>
  /** Optional until each platform bridge wires the corresponding IPC handlers. */
  agentAnswerQuestion?(answer: AgentQuestionAnswer): Promise<void>
  /** Optional until each platform bridge wires the corresponding IPC handlers. */
  agentResolveSkillCandidate?(candidateId: string, action: SkillCandidateAction): Promise<void>
  listSessions(): Promise<SessionMeta[]>
  createSession(): Promise<ChatSession>
  loadSession(id: string): Promise<ChatSession | null>
  deleteSession(id: string): Promise<void>
  /** 更新会话元信息：重命名 / 归档 */
  updateSession(id: string, patch: { title?: string; archived?: boolean; approvalPolicy?: import('./types').ApprovalPolicy; creativePreferences?: CreativePreferences }): Promise<void>
  updateSessionModelPreference(id: string, value: SessionModelPreference): Promise<void>
  onAgentEvent(cb: (envelope: AgentEventEnvelope) => void): () => void
  /** 新运行协议：用于断线重连时按 runId/seq 恢复事件。 */
  onRuntimeAgentEvent?: (cb: (envelope: RuntimeAgentEventEnvelope) => void) => () => void
  recoverRunEvents?: (runId: string, afterSeq?: number) => Promise<RunReplay>

  /* 远程部署（仅桌面端；其它平台实现为抛出「仅支持桌面端」） */
  deployTestConnection(input: import('./types').DeployConnectionInput): Promise<import('./types').DeployTestResult>
  deployInstall(input: import('./types').DeployTargetInput): Promise<import('./types').DeployRunResult>
  deployUpdate(targetId: string): Promise<import('./types').DeployRunResult>
  deployCancel(): Promise<void>
  deployLogs(targetId: string): Promise<string>
  deployUninstall(targetId: string): Promise<void>
  deployListTargets(): Promise<import('./types').DeployTargetPublic[]>
  deploySaveTarget(input: import('./types').DeployTargetInput): Promise<import('./types').DeployTargetPublic>
  deployDeleteTarget(id: string): Promise<void>
  onDeployEvent(cb: (progress: import('./types').DeployProgress) => void): () => void
}
