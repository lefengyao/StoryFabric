import { validateGoalTasks } from '../../shared/creative'
import type { GoalTask } from '../../shared/types'

const PLAN_FORMAT = '{"tasks":[{"id":"task-1","title":"任务标题","instructions":"执行说明","acceptanceCriteria":["可观察的完成条件"],"dependsOn":[]}]}'

export function buildGoalPlanningPrompt(goal: string, context: string): string {
  return [
    '你是 StoryFabric 的目标规划器。请把用户目标拆成可执行、可验证的任务清单。',
    '只读理解资料，不调用工具，不写入、删除或修改任何工作区内容。',
    '任务数量必须为 1 至 10 项；每项必须包含唯一 id、标题、说明、至少一条验收条件和依赖 id。',
    `仅输出 JSON，不要 Markdown、解释或 tool_calls。格式示例：${PLAN_FORMAT}`,
    '【用户目标开始】',
    goal,
    '【用户目标结束】',
    context ? `【只读上下文开始】\n${context}\n【只读上下文结束】` : '【无只读上下文】'
  ].join('\n')
}

function jsonText(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

export function parseGoalPlan(text: string): GoalTask[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText(text))
  } catch {
    throw new Error('目标规划器必须返回有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('目标计划必须是对象')
  const record = parsed as Record<string, unknown>
  if ('tool_calls' in record || 'tools' in record) throw new Error('目标计划不得包含工具调用')
  const tasks = validateGoalTasks(record.tasks)
  return tasks.map((task) => ({ ...task, status: 'pending', attempts: 0 }))
}

export function topologicalGoalTasks(tasks: GoalTask[]): GoalTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const indegree = new Map(tasks.map((task) => [task.id, task.dependsOn.length]))
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dependency of task.dependsOn) dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.id])
  }
  const queue = tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id)
  const ordered: GoalTask[] = []
  while (queue.length) {
    const id = queue.shift()!
    const task = byId.get(id)
    if (task) ordered.push(task)
    for (const dependent of dependents.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, next)
      if (next === 0) queue.push(dependent)
    }
  }
  if (ordered.length !== tasks.length) throw new Error('目标任务依赖存在循环')
  return ordered
}
