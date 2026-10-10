import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { saveChapter, saveCharacter, saveOutlineDoc } from '../../workspace/entityStore'
import { loadProjectContext, summarizeProjectContext } from '../projectContext'

describe('project context grounding', () => {
  it('keeps an independent chapter outline visible after its chapter is created', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '先章纲后章节')
    const outline = await saveOutlineDoc(store, { title: '第二十章章纲', kind: 'chapter', content: '先安排转折' })
    await saveChapter(store, { title: '第二十章', order: 20, box: 'draft', content: '' })

    const context = await loadProjectContext(store, { workspaceId: 'fixture', goal: '写第二十章' })
    const ref = context.sourceRefs.find((source) => source.entityId === outline.id)
    expect(ref?.sourcePath).toContain('outline/unassigned/')
  })

  it('locates a target chapter and related local facts without attachments', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '脱敏小说')
    await saveCharacter(store, { name: '甲', summary: '真实主角', content: '主角事实' })
    await saveChapter(store, { title: '第十九章', order: 19, content: '上一章正文' })
    await saveChapter(store, { title: '第二十章', order: 20, content: '' })
    await saveChapter(store, { title: '第二十一章', order: 21, content: '下一章正文' })

    const context = await loadProjectContext(store, { workspaceId: 'fixture', goal: '继续第二十章' })

    expect(context.targetChapter?.title).toBe('第二十章')
    expect(context.previousChapters.some((item) => item.content.includes('上一章正文'))).toBe(true)
    expect(context.nextChapters.some((item) => item.content.includes('下一章正文'))).toBe(true)
    expect(context.characters.some((character) => character.name === '甲')).toBe(true)
    expect(context.sourceRefs.some((source) => source.entityId === context.targetChapter?.id)).toBe(true)
    expect(context.missing).toEqual([])
  })

  it('reports an ambiguous or missing target instead of inventing a chapter id', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '歧义测试')
    await saveChapter(store, { title: '第二十章·上', order: 20, content: '上' })
    await saveChapter(store, { title: '第二十章·下', order: 20, content: '下' })

    const ambiguous = await loadProjectContext(store, { workspaceId: 'fixture', goal: '继续第二十章' })
    expect(ambiguous.targetChapter).toBeUndefined()
    expect(ambiguous.targetAmbiguous).toHaveLength(2)
    expect(ambiguous.missing.join('')).toContain('歧义')

    const missing = await loadProjectContext(store, { workspaceId: 'fixture', goal: '继续第三十章' })
    expect(missing.targetChapter).toBeUndefined()
    expect(missing.missing.join('')).toContain('未找到')
  })

  it('locates every chapter in a requested range instead of treating a range as an unknown target', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '范围测试')
    await saveChapter(store, { title: '第二十二章', order: 22, content: '前置正文' })
    const chapter23 = await saveChapter(store, { title: '第二十三章', order: 23, content: '第二十三章正文' })
    const chapter24 = await saveChapter(store, { title: '第二十四章', order: 24, content: '第二十四章正文' })
    await saveChapter(store, { title: '第二十五章', order: 25, content: '后续正文' })

    const context = await loadProjectContext(store, { workspaceId: 'fixture', goal: '优化23到24章节' })

    expect(context.targetChapters.map((chapter) => chapter.id)).toEqual([chapter23.id, chapter24.id])
    expect(context.targetContent).toContain('第二十三章正文')
    expect(context.targetContent).toContain('第二十四章正文')
    expect(context.sourceRefs.map((source) => source.entityId)).toEqual(expect.arrayContaining([chapter23.id, chapter24.id]))
    expect(summarizeProjectContext(context)).toContain('第二十三章')
    expect(context.missing).toEqual([])
  })
})
