import { describe, expect, it } from 'vitest'
import { TOOL_DEFS as CORE_TOOL_DEFS } from '../../../core/tools/registry'
import { TOOL_DEFS as MAIN_TOOL_DEFS } from '../registry'

describe('desktop tool registry parity', () => {
  // 核心与桌面端共享同一份 delete_note 契约：名称、描述、参数 schema 必须逐字一致。
  it('keeps the delete_note definition identical to core', () => {
    const core = CORE_TOOL_DEFS.find((tool) => tool.name === 'delete_note')
    const main = MAIN_TOOL_DEFS.find((tool) => tool.name === 'delete_note')

    expect(core).toBeDefined()
    expect(main).toEqual(core)
  })
})
