import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listChapters, listOutline, saveChapter } from '../../workspace/entityStore'
import { executeTool } from '../registry'

describe('agent placement guardrails', () => {
  it('does not silently put an unspecified chapter write in the main box', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')

    const rejected = await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '草稿章', status: 'draft' } }))
    expect(rejected.kind).toBe('result')
    expect(rejected.ok).toBe(false)
    expect(rejected.text).toContain('box')
    expect(await listChapters(store)).toHaveLength(0)

    const invalidVolume = await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '错误卷章', box: 'main', volumeId: 'vol_missing' } }))
    expect(invalidVolume.kind).toBe('result')
    expect(invalidVolume.ok).toBe(false)
    expect(invalidVolume.text).toContain('目标卷')

    const pending = await executeTool(store, 'save_chapter', JSON.stringify({ chapter: { title: '草稿章', box: 'draft', status: 'draft', content: '草稿内容' } }))
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') await pending.apply()
    expect((await listChapters(store))[0].box).toBe('draft')
  })

  it('requires explicit outline kind and preserves chapter outline ownership', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')
    const chapter = await saveChapter(store, { title: '目标章', box: 'draft', content: '正文' })

    const rejected = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { title: '目标章章纲' } }))
    expect(rejected.kind).toBe('result')
    expect(rejected.ok).toBe(false)
    expect(rejected.text).toContain('kind')

    const invalidChapter = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { title: '不存在的章纲', kind: 'chapter', chapterId: 'cha_missing' } }))
    expect(invalidChapter.kind).toBe('result')
    expect(invalidChapter.ok).toBe(false)
    expect(invalidChapter.text).toContain('未找到章纲关联的章节')

    const pending = await executeTool(store, 'save_outline_doc', JSON.stringify({ doc: { title: '目标章章纲', kind: 'chapter', chapterId: chapter.id, content: '# 章纲' } }))
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') await pending.apply()
    const outline = (await listOutline(store)).find((doc) => doc.title === '目标章章纲')
    expect(outline?.kind).toBe('chapter')
    expect(outline?.chapterId).toBe(chapter.id)
  })
})
