import type { AgentEvent, RunAgentRequest, UsageRecord } from '../../shared/types'
import type { CreativePackageSummary } from '../../shared/creative'
import { CoreAgentService, type AgentSettings } from '../../core/agent/agentLoop'
import { getAdapter } from '../../core/llm'
import { CoreSessionStore } from '../../core/workspace/sessionStore'
import { workspaceStore } from '../services/workspaceRuntime'
import { decryptApiKey, type SettingsService } from '../services/settingsService'
import { executeTool as executeMainTool } from '../tools/registry'
import { ContentPackageStore, summarizeContentPackage } from '../../core/skills/packageStore'
import { builtinPackages } from '../../core/skills/builtin'
import { RuleStore } from '../../core/rules/ruleStore'
import type { RuleLayer } from '../../core/rules/types'

/**
 * Electron 适配层：Agent 的状态机、工具循环和确认机制全部由 CoreAgentService 维护。
 * 主进程只负责把桌面设置、文件存储和事件桥接到核心实现。
 */
export class AgentService {
  private readonly services = new Map<string, CoreAgentService>()

  constructor(
    private readonly settings: SettingsService,
    private readonly emitEvent: (sessionId: string, event: AgentEvent, runId?: string) => void,
    private readonly onUsage?: (record: UsageRecord) => void
  ) {}

  private serviceFor(root: string): CoreAgentService {
    const existing = this.services.get(root)
    if (existing) return existing

    const store = workspaceStore(root)
    const service = new CoreAgentService({
      store,
      workspaceId: root,
      sessions: new CoreSessionStore(store),
      settings: async (): Promise<AgentSettings> => {
        const settings = await this.settings.load()
        return {
          providers: settings.providers.map((provider) => ({
            id: provider.id,
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            apiKey: decryptApiKey(provider.apiKeyEncrypted),
            name: provider.name,
            modelSettings: provider.modelSettings
          })),
          customPrompt: settings.customPrompt
        }
      },
      getAdapter,
      emit: (sessionId, event, runId) => this.emitEvent(sessionId, event, runId),
      onUsage: (record) => this.onUsage?.(record),
      executeTool: (name, argsJson) => executeMainTool(root, name, argsJson)
    })
    this.services.set(root, service)
    return service
  }

  confirmChange(changeId: string, approved: boolean): void {
    for (const service of this.services.values()) service.confirmChange(changeId, approved)
  }

  abort(sessionId: string): void {
    for (const service of this.services.values()) service.abort(sessionId)
  }

  async listCreativePackages(workspaceRoot: string): Promise<CreativePackageSummary[]> {
    const store = workspaceStore(workspaceRoot)
    const packageStore = new ContentPackageStore(store)
    const installed = await packageStore.list()
    const summaries = builtinPackages.map((pkg) => {
      const saved = installed.find((item) => item.manifest.id === pkg.manifest.id && item.manifest.version === pkg.manifest.version)
      return { id: pkg.manifest.id, version: pkg.manifest.version, name: pkg.manifest.name, description: pkg.manifest.description, enabled: saved?.enabled ?? true, skills: pkg.manifest.skills.map((item) => item.id), ruleSets: pkg.manifest.ruleSets.map((item) => item.id) }
    })
    return [...summaries, ...installed.filter((item) => !builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version)).map(summarizeContentPackage)]
  }

  async setCreativePackageEnabled(workspaceRoot: string, id: string, version: string, enabled: boolean): Promise<CreativePackageSummary> {
    const packageStore = new ContentPackageStore(workspaceStore(workspaceRoot))
    const builtin = builtinPackages.find((pkg) => pkg.manifest.id === id && pkg.manifest.version === version)
    const item = builtin ? await packageStore.save(builtin, enabled) : await packageStore.setEnabled(id, version, enabled)
    return summarizeContentPackage(item)
  }

  listCreativeRules(workspaceRoot: string): Promise<RuleLayer[]> { return new RuleStore(workspaceStore(workspaceRoot)).load() }
  saveCreativeRules(workspaceRoot: string, layers: RuleLayer[]): Promise<void> { return new RuleStore(workspaceStore(workspaceRoot)).save(layers) }

  run(workspaceRoot: string, req: RunAgentRequest): Promise<{ sessionId: string; runId: string }> {
    return this.serviceFor(workspaceRoot).run(req)
  }
}
