import type { ApprovalPolicy } from '../../shared/types'
import { normalizeApprovalPolicy } from '../../shared/creative'

export type MutationKind = 'create' | 'update' | 'move' | 'restore' | 'delete'

const MUTATION_KINDS: Record<string, MutationKind> = {
  save_character: 'update',
  save_relationship: 'update',
  save_event: 'update',
  save_outline_doc: 'update',
  save_chapter: 'update',
  edit_chapter: 'update',
  append_chapter: 'update',
  edit_content: 'update',
  save_setting: 'update',
  save_note: 'update',
  save_project_doc: 'update',
  move_chapter: 'move',
  restore_from_trash: 'restore',
  delete_note: 'delete',
  delete_event: 'delete',
  delete_entity: 'delete',
  rename_project_doc: 'move'
  ,create_volume: 'create'
}

export function classifyMutation(toolName: string): MutationKind | null {
  return MUTATION_KINDS[toolName] ?? null
}

export function requiresApproval(policy: ApprovalPolicy, toolName: string): boolean {
  const mutation = classifyMutation(toolName)
  if (!mutation || policy === 'auto') return false
  return policy === 'strict' || mutation === 'delete'
}

export function resolveApprovalPolicy(requested: ApprovalPolicy | undefined, persisted: unknown): ApprovalPolicy {
  return normalizeApprovalPolicy(requested ?? persisted)
}
