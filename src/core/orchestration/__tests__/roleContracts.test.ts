import { describe, expect, it } from 'vitest'
import { validateArtifactOutput } from '../artifactValidation'
import { buildRoleSystemPrompt, toolsForRole, uniqueToolDefs } from '../rolePrompts'

describe('orchestration role contracts', () => {
  it('gives each stage an independent responsibility and output contract', () => {
    const roles = ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'] as const
    const prompts = roles.map((role) => buildRoleSystemPrompt({ basePrompt: '基础系统设置', role, rules: `rule-${role}`, skills: `skill-${role}`, sources: `source-${role}` }))

    expect(new Set(prompts).size).toBe(roles.length)
    for (const [index, role] of roles.entries()) {
      expect(prompts[index]).toContain(`【当前角色】${role}`)
      expect(prompts[index]).toContain(`rule-${role}`)
      expect(prompts[index]).toContain(`skill-${role}`)
      expect(prompts[index]).toContain(`source-${role}`)
    }
  })

  it('gives every stage access to project reads while reserving mutations for the executor', () => {
    for (const role of ['plan', 'setting', 'prompt', 'anti-ai', 'polish', 'review', 'continuity', 'style'] as const) {
      const tools = toolsForRole(role)
      expect(tools.some((tool) => tool.name === 'list_characters')).toBe(true)
      expect(tools.some((tool) => tool.name === 'read_content_lines')).toBe(true)
      expect(tools.some((tool) => tool.name === 'edit_content')).toBe(false)
      expect(tools.some((tool) => tool.name === 'append_chapter')).toBe(false)
      expect(tools.some((tool) => tool.name.startsWith('save_') || tool.name.startsWith('delete_'))).toBe(false)
    }
    const executorTools = toolsForRole('write')
    expect(executorTools.some((tool) => tool.name === 'get_chapter')).toBe(true)
    expect(executorTools.some((tool) => tool.name === 'save_chapter')).toBe(true)
    expect(executorTools.some((tool) => tool.name === 'append_chapter')).toBe(true)
    expect(executorTools.some((tool) => tool.name === 'read_content_lines')).toBe(true)
    expect(executorTools.some((tool) => tool.name === 'edit_content')).toBe(true)
  })

  it('deduplicates optional tool groups before they reach a provider', () => {
    const tools = uniqueToolDefs([...toolsForRole('plan'), ...toolsForRole('plan')])
    expect(tools.map((tool) => tool.name).length).toBe(new Set(tools.map((tool) => tool.name)).size)
    expect(tools.filter((tool) => tool.name === 'list_skills')).toHaveLength(1)
  })

  it('rejects fake tool markup, empty output, and read-intent placeholder output', () => {
    expect(validateArtifactOutput({ stageId: 'plan', kind: 'plan', text: '<tool_call>list_characters</tool_call>' }).ok).toBe(false)
    expect(validateArtifactOutput({ stageId: 'plan', kind: 'plan', text: '' }).ok).toBe(false)
    expect(validateArtifactOutput({ stageId: 'plan', kind: 'plan', text: '我先读取项目资料' }).ok).toBe(false)
    expect(validateArtifactOutput({ stageId: 'plan', kind: 'plan', text: '资料已读取，目标是第二十章。', hasToolReceipt: true }).ok).toBe(true)
  })
})
