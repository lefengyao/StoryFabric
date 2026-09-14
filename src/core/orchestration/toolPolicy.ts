export const READ_ONLY_SUBAGENT_TOOLS = ['search_project', 'get_chapter_context', 'list_characters', 'get_outline', 'get_setting', 'get_note', 'list_events'] as const
export type ReadOnlySubagentTool = typeof READ_ONLY_SUBAGENT_TOOLS[number]

export function validateSubagentTools(requestedTools: string[] = []): void {
  const allowed = new Set<string>(READ_ONLY_SUBAGENT_TOOLS)
  const denied = requestedTools.find((tool) => !allowed.has(tool))
  if (denied) throw new Error(`子智能体只读，禁止工具：${denied}`)
}
