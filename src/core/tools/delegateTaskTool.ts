import { SubagentManager, type DelegateTaskInput } from '../orchestration/subagents'

export function createDelegateTaskTool(manager: SubagentManager): { name: 'delegate_task'; execute(input: DelegateTaskInput): Promise<ReturnType<SubagentManager['list']>[number]> } {
  return { name: 'delegate_task', execute: (input) => manager.delegate(input) }
}
