import { validateSubagentTools } from './toolPolicy'

export interface SubagentSourceRef { workspaceId: string; id: string; revision?: number }
export interface DelegateTaskInput { task: string; role: string; depth: number; sourceRefs: SubagentSourceRef[]; expectedOutput?: string; tokenCap?: number; requestedTools?: string[] }
export interface ChildTask { id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; input: DelegateTaskInput }

export class SubagentManager {
  private readonly children = new Map<string, ChildTask>()
  private readonly maxChildren: number
  private readonly maxConcurrent: number

  constructor(private readonly options: { workspaceId: string; maxChildren?: number; maxConcurrent?: number }) {
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
    return structuredClone(task)
  }

  cancel(id: string): void {
    const task = this.children.get(id)
    if (task && task.status !== 'completed' && task.status !== 'failed') task.status = 'cancelled'
  }

  list(): ChildTask[] { return [...this.children.values()].map((task) => structuredClone(task)) }
  private activeCount(): number { return [...this.children.values()].filter((task) => task.status === 'running').length }
}
