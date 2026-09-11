import type { AgentEvent, RunAgentRequest, UsageRecord } from '../../shared/types'
import { CoreAgentService, type AgentSettings } from '../../core/agent/agentLoop'
import { getAdapter } from '../../core/llm'
import { CoreSessionStore } from '../../core/workspace/sessionStore'
import { workspaceStore } from '../services/workspaceRuntime'
import { decryptApiKey, type SettingsService } from '../services/settingsService'
import { executeTool as executeMainTool } from '../tools/registry'

/**
 * Electron 适配层：Agent 的状态机、工具循环和确认机制全部由 CoreAgentService 维护。
 * 主进程只负责把桌面设置、文件存储和事件桥接到核心实现。
 */
export class AgentService {
  private readonly services = new Map<string, CoreAgentService>()

  constructor(
    private readonly settings: SettingsService,
    private readonly emitEvent: (sessionId: string, event: AgentEvent) => void,
    private readonly onUsage?: (record: UsageRecord) => void
  ) {}

  private serviceFor(root: string): CoreAgentService {
    const existing = this.services.get(root)
    if (existing) return existing

    const store = workspaceStore(root)
    const service = new CoreAgentService({
      store,
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
      emit: (sessionId, event) => this.emitEvent(sessionId, event),
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

  run(workspaceRoot: string, req: RunAgentRequest): Promise<{ sessionId: string }> {
    return this.serviceFor(workspaceRoot).run(req)
  }
}
