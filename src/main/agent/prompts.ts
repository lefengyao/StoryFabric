/**
 * The Electron agent uses the same policy as the core runtime. Keeping one
 * source of truth prevents a desktop-only prompt from drifting from tests or
 * other runtimes.
 */
export { SYSTEM_PROMPT } from '../../core/agent/prompts'
export { WORKSPACE_PLACEMENT_POLICY } from '../../core/agent/workspacePolicy'
