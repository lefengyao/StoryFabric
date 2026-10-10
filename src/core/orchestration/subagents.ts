import { cloneValue } from '../../shared/runtimeCompatibility'
import { validateSubagentTools } from './toolPolicy'

export interface SubagentSourceRef { workspaceId: string; id: string; revision?: string | number; sourcePath?: string }
export interface DelegateTaskInput { task: string; role: string; depth: number; sourceRefs: SubagentSourceRef[]; expectedOutput?: string; tokenCap?: number; requestedTools?: string[] }
export interface ChildTask { id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; input: DelegateTaskInput; result?: { text: string; payload?: unknown }; error?: string }

export class SubagentManager {
  private readonly children = new Map<string, ChildTask>()
  private readonly maxChildren: number
  private readonly maxConcurrent: number
  private readonly controllers = new Map<string, AbortController>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly idleWaiters = new Set<() => void>()

  constructor(private readonly options: { workspaceId: string; maxChildren?: number; maxConcurrent?: number; runTask?: (input: DelegateTaskInput, signal: AbortSignal) => Promise<{ text: string; payload?: unknown }> }) {
    this.maxChildren = options.maxChildren ?? 4
    this.maxConcurrent = options.maxConcurrent ?? 2
  }

  async delegate(input: DelegateTaskInput): Promise<ChildTask> {
    if (!input.task.trim() || !input.role.trim()) throw new Error('子任务和角色不能为空')
    if (input.depth !== 1) throw new Error('子智能体最大深度为 1，禁止递归派生')
    if (this.children.size >= this.maxChildren) throw new Error('子智能体数量超过上限')
    if (input.sourceRefs.some((ref) => ref.workspaceId !== this.options.workspaceId)) throw new Error('子智能体不能读取其他工作区')
    validateSubagentTools(input.requestedTools)
    if (input.tokenCap !== undefined && (!Number.isInteger(input.tokenCap) || input.tokenCap < 1)) throw new Error('子任务 tokenCap 无效')
    const id = `child_${this.children.size + 1}`
    const task: ChildTask = { id, status: 'queued', input: { ...input, sourceRefs: input.sourceRefs.map((ref) => ({ ...ref })) } }
    this.children.set(id, task)
    this.schedule()
    return cloneValue(task)
  }

  async waitForIdle(): Promise<void> {
    while (this.running.size > 0 || [...this.children.values()].some((task) => task.status === 'queued')) {
      await new Promise<void>((resolve) => this.idleWaiters.add(resolve))
    }
  }

  private schedule(): void {
    while (this.running.size < this.maxConcurrent) {
      const task = [...this.children.values()].find((item) => item.status === 'queued')
      if (!task || !this.options.runTask) break
      task.status = 'running'
      const controller = new AbortController()
      this.controllers.set(task.id, controller)
      const running = this.runTask(task, controller).finally(() => {
        this.running.delete(task.id)
        this.schedule()
        this.notifyIdleWaiters()
      })
      this.running.set(task.id, running)
    }
    this.notifyIdleWaiters()
  }

  private notifyIdleWaiters(): void {
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }

  private async runTask(task: ChildTask, controller: AbortController): Promise<void> {
    try {
      task.result = await this.options.runTask!(task.input, controller.signal)
      if (task.status === 'running') task.status = 'completed'
    } catch (error) {
      if (task.status === 'running') {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      this.controllers.delete(task.id)
    }
  }

  cancel(id: string): void {
    const task = this.children.get(id)
    if (task && task.status !== 'completed' && task.status !== 'failed') {
      task.status = 'cancelled'
      this.controllers.get(id)?.abort()
      this.schedule()
    }
  }

  list(): ChildTask[] { return [...this.children.values()].map((task) => cloneValue(task)) }
}
