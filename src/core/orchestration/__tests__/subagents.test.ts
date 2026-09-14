import { expect, it } from 'vitest'
import { SubagentManager } from '../subagents'

it('allows bounded read-only child tasks and rejects recursion, cross-workspace access and writes', async () => {
  const manager = new SubagentManager({ workspaceId: 'w', maxChildren: 4, maxConcurrent: 2 })
  await expect(manager.delegate({ task: '核对人物', role: 'character-check', depth: 1, sourceRefs: [{ workspaceId: 'w', id: 'character-1' }] })).resolves.toMatchObject({ status: 'queued' })
  await expect(manager.delegate({ task: '再派一个', role: 'check', depth: 2, sourceRefs: [] })).rejects.toThrow(/深度|递归/)
  await expect(manager.delegate({ task: '读别的工作区', role: 'check', depth: 1, sourceRefs: [{ workspaceId: 'other', id: 'x' }] })).rejects.toThrow(/工作区|权限/)
  await expect(manager.delegate({ task: '写正文', role: 'writer', depth: 1, sourceRefs: [], requestedTools: ['save_chapter'] })).rejects.toThrow(/只读|写入/)
})

it('limits the number of child tasks', async () => {
  const manager = new SubagentManager({ workspaceId: 'w', maxChildren: 1, maxConcurrent: 1 })
  await manager.delegate({ task: 'one', role: 'check', depth: 1, sourceRefs: [] })
  await expect(manager.delegate({ task: 'two', role: 'check', depth: 1, sourceRefs: [] })).rejects.toThrow(/上限|数量/)
})
