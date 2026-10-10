import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { executeProjectDocTool } from '../projectDocTools'
import { contentRevision } from '../../workspace/resourceRevision'
import { epubFixture } from '../../../shared/__tests__/fixtures/documentFixtures'

describe('project docs tools', () => {
  it('lists EPUB format and reads paginated book text with a binary rename revision', async () => {
    const store = new MemoryFileStore()
    const bytes = await epubFixture()
    await store.writeBytes('docs/nested/book.epub', bytes)
    const list = await executeProjectDocTool(store, 'list_project_docs', {})
    if (list.kind !== 'result') throw new Error('expected list')
    expect(JSON.parse(list.text).files).toContainEqual({ path: 'nested/book.epub', format: 'epub', size: bytes.byteLength, readable: true })
    const read = await executeProjectDocTool(store, 'read_project_doc', { path: 'nested/book.epub', maxChars: 3 })
    if (read.kind !== 'result') throw new Error('expected read')
    const page = JSON.parse(read.text)
    expect(page).toMatchObject({ content: '第一章', truncated: true, nextOffset: 3 })
    expect(page.fileRevision).not.toBe(page.writeRevision)
    const next = await executeProjectDocTool(store, 'read_project_doc', { path: 'nested/book.epub', offset: page.nextOffset })
    if (next.kind !== 'result') throw new Error('expected read')
    expect(JSON.parse(next.text).content).toContain('第二章')
    const rename = await executeProjectDocTool(store, 'rename_project_doc', { fromPath: 'nested/book.epub', toPath: 'book.epub', baseRevision: page.fileRevision })
    if (rename.kind !== 'pending') throw new Error('expected pending')
    expect((await rename.apply()).ok).toBe(true)
    expect(await store.readBytes('docs/book.epub')).toEqual(bytes)
  })

  it('cannot save text over or create a binary document', async () => {
    const store = new MemoryFileStore()
    const bytes = await epubFixture()
    await store.writeBytes('docs/book.epub', bytes)
    for (const path of ['book.epub', 'new.epub', 'new.pdf', 'new.docx']) {
      await expect(executeProjectDocTool(store, 'save_project_doc', { path, content: 'replacement' })).rejects.toThrow(/纯文本/)
    }
    expect(await store.readBytes('docs/book.epub')).toEqual(bytes)
  })

  it('lists, reads and only writes after confirmation', async () => {
    const store = new MemoryFileStore()
    await store.ensureDir('docs')
    await store.writeText('docs/plan.md', '# 计划')
    const list = await executeProjectDocTool(store, 'list_project_docs', {})
    expect(list.kind).toBe('result')
    const read = await executeProjectDocTool(store, 'read_project_doc', { path: 'plan.md' })
    expect(read.kind).toBe('result')
    if (read.kind !== 'result') throw new Error('expected result')
    const revision = (JSON.parse(read.text) as { revision: string }).revision
    const pending = await executeProjectDocTool(store, 'save_project_doc', { path: 'plan.md', content: '# 新计划', baseRevision: revision })
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
    const pending = await executeProjectDocTool(store, 'save_project_doc', { path: 'plan.md', content: '智能体内容', baseRevision: contentRevision('原内容') })
    if (pending.kind !== 'pending') throw new Error('expected pending')
    await store.writeText('docs/plan.md', '人为内容')
    expect(await pending.apply()).toEqual({ ok: false, text: '项目文档已被修改，未覆盖：plan.md' })
    expect(await store.readText('docs/plan.md')).toBe('人为内容')
  })

  it('renames a project document only after confirmation and preserves the source revision', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/old-name.md', '原文')
    const revision = contentRevision('原文')
    const pending = await executeProjectDocTool(store, 'rename_project_doc', { fromPath: 'old-name.md', toPath: 'nested/new-name.md', baseRevision: revision })
    expect(pending.kind).toBe('pending')
    expect(await store.readText('docs/old-name.md')).toBe('原文')
    expect(await store.readText('docs/nested/new-name.md')).toBeNull()
    if (pending.kind !== 'pending') throw new Error('expected pending')
    expect(await pending.apply()).toEqual({ ok: true, text: '已将项目文档「old-name.md」重命名为「nested/new-name.md」' })
    expect(await store.readText('docs/old-name.md')).toBeNull()
    expect(await store.readText('docs/nested/new-name.md')).toBe('原文')
  })

  it('rejects stale, unsafe and conflicting project document renames', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/a.md', '甲')
    await store.writeText('docs/b.md', '乙')
    const revision = contentRevision('甲')
    await expect(executeProjectDocTool(store, 'rename_project_doc', { fromPath: 'a.md', toPath: 'b.md', baseRevision: revision })).rejects.toThrow('目标项目文档已存在')
    await expect(executeProjectDocTool(store, 'rename_project_doc', { fromPath: '../a.md', toPath: 'c.md', baseRevision: revision })).rejects.toThrow()
    await store.writeText('docs/a.md', '已变更')
    await expect(executeProjectDocTool(store, 'rename_project_doc', { fromPath: 'a.md', toPath: 'c.md', baseRevision: revision })).rejects.toThrow('版本已变化')
  })

  it('reports a conflict when the source changes while a rename waits for approval', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/a.md', '甲')
    const revision = contentRevision('甲')
    const pending = await executeProjectDocTool(store, 'rename_project_doc', { fromPath: 'a.md', toPath: 'c.md', baseRevision: revision })
    if (pending.kind !== 'pending') throw new Error('expected pending')
    await store.writeText('docs/a.md', '人为修改')
    expect(await pending.apply()).toEqual({ ok: false, text: '项目文档已被修改，未重命名：a.md' })
    expect(await store.readText('docs/c.md')).toBeNull()
  })
})
