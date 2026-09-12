import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { executeProjectDocTool } from '../projectDocTools'

describe('project docs tools', () => {
  it('lists, reads and only writes after confirmation', async () => {
    const store = new MemoryFileStore()
    await store.ensureDir('docs')
    await store.writeText('docs/plan.md', '# 计划')
    const list = await executeProjectDocTool(store, 'list_project_docs', {})
    expect(list.kind).toBe('result')
    const read = await executeProjectDocTool(store, 'read_project_doc', { path: 'plan.md' })
    expect(read.kind).toBe('result')
    const pending = await executeProjectDocTool(store, 'save_project_doc', { path: 'plan.md', content: '# 新计划' })
    expect(pending.kind).toBe('pending')
    expect(await store.readText('docs/plan.md')).toBe('# 计划')
    if (pending.kind !== 'pending') throw new Error('expected pending')
    expect((await pending.apply()).ok).toBe(true)
    expect(await store.readText('docs/plan.md')).toBe('# 新计划')
  })

  it('rejects path escape, extra properties and concurrent overwrite', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/plan.md', '原内容')
    await expect(executeProjectDocTool(store, 'read_project_doc', { path: '../plan.md' })).rejects.toThrow()
    await expect(executeProjectDocTool(store, 'read_project_doc', { path: 'plan.md', nope: true })).rejects.toThrow('不接受参数')
    const pending = await executeProjectDocTool(store, 'save_project_doc', { path: 'plan.md', content: '智能体内容' })
    if (pending.kind !== 'pending') throw new Error('expected pending')
    await store.writeText('docs/plan.md', '人为内容')
    expect(await pending.apply()).toEqual({ ok: false, text: '项目文档已被修改，未覆盖：plan.md' })
    expect(await store.readText('docs/plan.md')).toBe('人为内容')
  })
})
