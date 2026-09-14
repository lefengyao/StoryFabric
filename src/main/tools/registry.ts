import { NodeFileStore } from '../../core/storage/nodeFileStore'
import {
  executeTool as executeCoreTool,
  TOOL_DEFS as CORE_TOOL_DEFS,
  WRITE_TOOLS as CORE_WRITE_TOOLS,
  type ToolOutcome
} from '../../core/tools/registry'

export type { ToolOutcome } from '../../core/tools/registry'

export const TOOL_DEFS = CORE_TOOL_DEFS
export const WRITE_TOOLS = new Set(CORE_WRITE_TOOLS)

/** Electron is a storage adapter only; parsing, validation and execution live in core. */
export function executeTool(root: string, name: string, argsJson: string): Promise<ToolOutcome> {
  return executeCoreTool(new NodeFileStore(root), name, argsJson)
}
