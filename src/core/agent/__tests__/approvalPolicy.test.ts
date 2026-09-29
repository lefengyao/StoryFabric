import { describe, expect, it } from 'vitest'
import { classifyMutation, requiresApproval, resolveApprovalPolicy } from '../approvalPolicy'

describe('approval policy', () => {
  it.each(['save_character', 'save_project_doc', 'rename_project_doc', 'append_chapter', 'move_chapter', 'restore_from_trash'])('strict blocks %s', (toolName) => {
    expect(requiresApproval('strict', toolName)).toBe(true)
  })

  it('delete-confirm blocks every delete tool but lets writes pass', () => {
    expect(requiresApproval('delete-confirm', 'save_note')).toBe(false)
    expect(requiresApproval('delete-confirm', 'delete_note')).toBe(true)
    expect(requiresApproval('delete-confirm', 'delete_event')).toBe(true)
    expect(requiresApproval('delete-confirm', 'delete_entity')).toBe(true)
  })

  it('auto never blocks a recognized mutation and never classifies read tools as mutations', () => {
    expect(requiresApproval('auto', 'save_chapter')).toBe(false)
    expect(classifyMutation('search_project')).toBeNull()
  })

  it('uses the persisted session policy when a request omits its policy', () => {
    expect(resolveApprovalPolicy(undefined, 'auto')).toBe('auto')
    expect(resolveApprovalPolicy(undefined, 'delete-confirm')).toBe('delete-confirm')
    expect(resolveApprovalPolicy('strict', 'auto')).toBe('strict')
  })
})
