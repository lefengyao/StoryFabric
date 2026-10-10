import type { AgentEvent, GoalRun, RunAgentRequest, UsageRecord } from '../../shared/types'
import type { AgentQuestionAnswer, SkillCandidateAction } from '../../shared/agentQuestions'
import type { CreativePackageSummary } from '../../shared/creative'
import { CoreAgentService, type AgentSettings } from '../../core/agent/agentLoop'
import { getAdapter } from '../../core/llm'
import { electronFetch } from '../networkFetch'
import { CoreSessionStore } from '../../core/workspace/sessionStore'
import { workspaceStore } from '../services/workspaceRuntime'
import { decryptApiKey, type SettingsService } from '../services/settingsService'
import { executeTool as executeMainTool } from '../tools/registry'
import { ContentPackageStore, summarizeContentPackage } from '../../core/skills/packageStore'
import { builtinPackages } from '../../core/skills/builtin'
import { RuleStore } from '../../core/rules/ruleStore'
import type { RuleLayer } from '../../core/rules/types'
import type { ContentPackage } from '../../core/skills/types'
import { GoalStore } from '../../core/goal/goalStore'
import type { FileStore } from '../../core/storage/fileStore'
import { GlobalSkillLibrary } from '../../core/skills/globalSkillLibrary'
import { ActiveRunTracker } from './activeRunTracker'
import { MemoryStore } from '../../core/memory/memoryStore'
import type { CloudAccountService } from '../../core/cloud/cloudAccountService'

/**
 * Electron 适配层：Agent 的状态机、工具循环和确认机制全部由 CoreAgentService 维护。
 * 主进程只负责把桌面设置、文件存储和事件桥接到核心实现。
 */
export class AgentService {
  private readonly services = new Map<string, CoreAgentService>()
  private readonly activeRuns: ActiveRunTracker

  constructor(
    private readonly settings: SettingsService,
    private readonly emitEvent: (sessionId: string, event: AgentEvent, runId?: string, workspaceId?: string) => void,
    private readonly onUsage?: (record: UsageRecord) => void,
    private readonly globalStore?: FileStore,
    onBackgroundActivity?: (active: boolean) => void,
    private readonly cloudAccount?: CloudAccountService
  ) {
    this.activeRuns = new ActiveRunTracker(onBackgroundActivity ?? (() => undefined))
  }

  private async runWithActivity(workspaceRoot: string, req: RunAgentRequest): Promise<{ sessionId: string; runId: string; goalId?: string; status?: GoalRun['status']; planVersion?: number }> {
    const finish = this.activeRuns.begin()
    try {
      return await this.serviceFor(workspaceRoot).run(req)
    } finally {
      finish()
    }
  }

  private serviceFor(root: string): CoreAgentService {
    const existing = this.services.get(root)
    if (existing) return existing

    const store = workspaceStore(root)
    const service = new CoreAgentService({
      store,
      workspaceId: root,
      sessions: new CoreSessionStore(store, root),
      settings: async (): Promise<AgentSettings> => {
        const settings = await this.settings.load()
        const cloudProvider = await this.cloudAccount?.agentProvider(settings.trailblazerProvider)
        return {
          providers: [...settings.providers.map((provider) => ({
            id: provider.id,
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            apiKey: decryptApiKey(provider.apiKeyEncrypted),
            name: provider.name,
            modelSettings: provider.modelSettings
          })), ...(cloudProvider ? [cloudProvider] : [])],
          customPrompt: settings.customPrompt,
          agentGeneration: settings.agentGeneration,
        }
      },
      getAdapter: (protocol, baseUrl, options) => getAdapter(protocol, baseUrl, { ...options, fetcher: electronFetch }),
      emit: (sessionId, event, runId) => this.emitEvent(sessionId, event, runId, root),
      onUsage: (record) => this.onUsage?.(record),
      executeTool: (name, argsJson) => executeMainTool(root, name, argsJson),
      globalSkillLibrary: this.globalStore ? new GlobalSkillLibrary(this.globalStore) : undefined,
      memoryStore: this.globalStore ? new MemoryStore(this.globalStore, store) : undefined,
      consumeLegacyCustomPrompt: (migrate) => this.settings.consumeLegacyCustomPrompt(migrate)
    })
    this.services.set(root, service)
    return service
  }

  confirmChange(changeId: string, approved: boolean, sessionId?: string, decision?: import('../../shared/api').AgentChangeDecision): void {
    for (const service of this.services.values()) service.confirmChange(changeId, approved, sessionId, decision)
  }

  /** Scope approval to the workspace currently selected by the renderer. */
  confirmChangeForWorkspace(workspaceRoot: string, changeId: string, approved: boolean, sessionId?: string, decision?: import('../../shared/api').AgentChangeDecision): void {
    this.serviceFor(workspaceRoot).confirmChange(changeId, approved, sessionId, decision)
  }

  abort(sessionId: string): void {
    for (const service of this.services.values()) service.abort(sessionId)
  }

  /** Scope cancellation to the workspace currently selected by the renderer. */
  abortForWorkspace(workspaceRoot: string, sessionId: string): void {
    this.serviceFor(workspaceRoot).abort(sessionId)
  }

  isRunning(workspaceRoot: string, sessionId: string): boolean {
    return this.serviceFor(workspaceRoot).getActiveRunId(sessionId) !== undefined
  }

  async answerQuestion(workspaceRoot: string, answer: AgentQuestionAnswer): Promise<void> {
    await this.serviceFor(workspaceRoot).answerQuestion(answer)
  }

  async resolveSkillCandidate(workspaceRoot: string, candidateId: string, action: SkillCandidateAction): Promise<void> {
    await this.serviceFor(workspaceRoot).resolveSkillCandidate(candidateId, action)
  }

  async listCreativePackages(workspaceRoot?: string): Promise<CreativePackageSummary[]> {
    const installed = this.globalStore
      ? await new GlobalSkillLibrary(this.globalStore).list()
      : await new ContentPackageStore(workspaceStore(workspaceRoot ?? '')).list()
    const summaries = builtinPackages.map((pkg) => {
      const saved = installed.find((item) => item.manifest.id === pkg.manifest.id && item.manifest.version === pkg.manifest.version)
      return { id: pkg.manifest.id, version: pkg.manifest.version, name: pkg.manifest.name, description: pkg.manifest.description, enabled: saved?.enabled ?? true, skills: pkg.manifest.skills.map((item) => item.id), ruleSets: pkg.manifest.ruleSets.map((item) => item.id) }
    })
    return [...summaries, ...installed.filter((item) => !builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version)).map(summarizeContentPackage)]
  }

  async setCreativePackageEnabled(workspaceRoot: string | undefined, id: string, version: string, enabled: boolean): Promise<CreativePackageSummary> {
    const builtin = builtinPackages.find((pkg) => pkg.manifest.id === id && pkg.manifest.version === version)
    const item = this.globalStore
      ? (builtin ? await new GlobalSkillLibrary(this.globalStore).install(builtin, enabled) : await new GlobalSkillLibrary(this.globalStore).setEnabled(id, version, enabled))
      : await (async () => {
        const packageStore = new ContentPackageStore(workspaceStore(workspaceRoot ?? ''))
        return builtin ? packageStore.save(builtin, enabled) : packageStore.setEnabled(id, version, enabled)
      })()
    return summarizeContentPackage(item)
  }

  async installCreativePackage(workspaceRoot: string | undefined, input: ContentPackage): Promise<CreativePackageSummary> {
    const installed = this.globalStore
      ? await new GlobalSkillLibrary(this.globalStore).install(input, true)
      : await new ContentPackageStore(workspaceStore(workspaceRoot ?? '')).save(input, true)
    return summarizeContentPackage(installed)
  }

  listCreativeRules(workspaceRoot: string): Promise<RuleLayer[]> { return new RuleStore(workspaceStore(workspaceRoot)).load() }
  saveCreativeRules(workspaceRoot: string, layers: RuleLayer[]): Promise<void> { return new RuleStore(workspaceStore(workspaceRoot)).save(layers) }

  run(workspaceRoot: string, req: RunAgentRequest): Promise<{ sessionId: string; runId: string; goalId?: string; status?: GoalRun['status']; planVersion?: number }> {
    return this.runWithActivity(workspaceRoot, req)
  }

  compressSessionContext(workspaceRoot: string, sessionId: string, providerId: string, model: string): Promise<import('../../shared/types').ChatSession> {
    return this.serviceFor(workspaceRoot).compressSessionContext(sessionId, providerId, model)
  }

  async listGoals(workspaceRoot: string): Promise<GoalRun[]> { return new GoalStore(workspaceStore(workspaceRoot)).list(workspaceRoot) }
  async getGoal(workspaceRoot: string, id: string): Promise<GoalRun | null> {
    const goal = await new GoalStore(workspaceStore(workspaceRoot)).get(id)
    if (!goal) return null
    if (goal.workspaceId !== workspaceRoot) throw new Error('目标不属于当前工作区')
    return goal
  }

  private async goalModel(): Promise<{ providerId: string; model: string }> {
    const settings = await this.settings.load()
    const preferred = settings.defaultChatModel
    if (preferred && settings.providers.some((provider) => provider.id === preferred.providerId && provider.models.includes(preferred.model))) return preferred
    const provider = settings.providers.find((item) => item.models.length > 0 && decryptApiKey(item.apiKeyEncrypted))
    if (!provider) throw new Error('请先配置可用的供应商和模型')
    return { providerId: provider.id, model: provider.models[0] }
  }

  async continueGoal(workspaceRoot: string, id: string): Promise<{ goalId: string; runId: string; status?: GoalRun['status'] }> {
    const goal = await new GoalStore(workspaceStore(workspaceRoot)).assertWorkspace(id, workspaceRoot)
    const model = await this.goalModel()
    const result = await this.runWithActivity(workspaceRoot, { mode: 'goal', goalRunId: goal.id, message: goal.goal, sessionId: goal.sessionId, approvalPolicy: goal.approvalPolicy, ...model })
    if (!result.goalId) throw new Error('目标运行未返回目标 ID')
    return { ...result, goalId: result.goalId }
  }

  async stopGoal(workspaceRoot: string, id: string): Promise<void> {
    const goal = await new GoalStore(workspaceStore(workspaceRoot)).assertWorkspace(id, workspaceRoot)
    this.serviceFor(workspaceRoot).abort(goal.sessionId)
  }

  async replanGoal(workspaceRoot: string, id: string): Promise<{ goalId: string; planVersion?: number; status?: GoalRun['status'] }> {
    const goal = await new GoalStore(workspaceStore(workspaceRoot)).assertWorkspace(id, workspaceRoot)
    const model = await this.goalModel()
    const result = await this.runWithActivity(workspaceRoot, { mode: 'goal', goalAction: 'replan', goalRunId: goal.id, message: goal.goal, sessionId: goal.sessionId, approvalPolicy: goal.approvalPolicy, ...model })
    if (!result.goalId) throw new Error('目标运行未返回目标 ID')
    return { ...result, goalId: result.goalId }
  }
}
