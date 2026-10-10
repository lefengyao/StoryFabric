import { TOOL_DEFS, WRITE_TOOLS } from '../tools/registry'

/** Tools that can inspect the active workspace without producing a mutation. */
export const READ_ONLY_SUBAGENT_TOOLS = TOOL_DEFS
  .filter((definition) => !WRITE_TOOLS.has(definition.name))
  .map((definition) => definition.name) as readonly string[]
export type ReadOnlySubagentTool = string

export function readOnlyToolDefs(requestedTools: string[] = []): typeof TOOL_DEFS {
  validateSubagentTools(requestedTools)
  return TOOL_DEFS.filter((definition) => READ_ONLY_SUBAGENT_TOOLS.includes(definition.name))
}

export function validateSubagentTools(requestedTools: string[] = []): void {
  const allowed = new Set<string>(READ_ONLY_SUBAGENT_TOOLS)
  const denied = requestedTools.find((tool) => !allowed.has(tool))
  if (denied) throw new Error(`子智能体只读，禁止工具：${denied}`)
}
