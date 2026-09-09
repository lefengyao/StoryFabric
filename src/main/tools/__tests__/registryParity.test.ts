import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../../core/storage/fileStore'
import { NodeFileStore } from '../../../core/storage/nodeFileStore'
import { initializeWorkspace } from '../../../core/workspace/workspaceService'
import { executeTool as executeCoreTool, TOOL_DEFS as CORE_TOOL_DEFS } from '../../../core/tools/registry'
import { executeTool as executeMainTool, TOOL_DEFS as MAIN_TOOL_DEFS } from '../registry'

describe('desktop tool registry parity', () => {
  // 核心与桌面端共享同一份 delete_note 契约：名称、描述、参数 schema 必须逐字一致。
  it('keeps the delete_note definition identical to core', () => {
    const core = CORE_TOOL_DEFS.find((tool) => tool.name === 'delete_note')
    const main = MAIN_TOOL_DEFS.find((tool) => tool.name === 'delete_note')

    expect(core).toBeDefined()
    expect(main).toEqual(core)
  })

  it('reports the same failure text and preview for an unknown note', async () => {
    const memory = new MemoryFileStore()
    await initializeWorkspace(memory, '测试')
    const root = await mkdtemp(join(tmpdir(), 'sf-parity-'))
    try {
      await initializeWorkspace(new NodeFileStore(root), '测试')
      const args = JSON.stringify({ noteId: 'note_missing' })
      const core = await executeCoreTool(memory, 'delete_note', args)
      const main = await executeMainTool(root, 'delete_note', args)
      expect(main).toEqual(core)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
