import type { ApprovalPolicy } from '../../shared/types'

export type MutationKind = 'create' | 'update' | 'move' | 'restore' | 'delete'

const MUTATION_KINDS: Record<string, MutationKind> = {
  save_character: 'update',
  save_relationship: 'update',
  save_event: 'update',
  save_outline_doc: 'update',
  save_chapter: 'update',
  save_setting: 'update',
  save_note: 'update',
  save_project_doc: 'update',
  move_chapter: 'move',
  restore_from_trash: 'restore',
  delete_note: 'delete',
  delete_event: 'delete',
  delete_entity: 'delete'
}

export function classifyMutation(toolName: string): MutationKind | null {
  return MUTATION_KINDS[toolName] ?? null
}

export function requiresApproval(policy: ApprovalPolicy, toolName: string): boolean {
  const mutation = classifyMutation(toolName)
  if (!mutation || policy === 'auto') return false
  return policy === 'strict' || mutation === 'delete'
}
