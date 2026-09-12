import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../../core/storage/fileStore'
import { NodeFileStore } from '../../../core/storage/nodeFileStore'
import { initializeWorkspace } from '../../../core/workspace/workspaceService'
import { saveCharacter, saveChapter, saveNote } from '../../../core/workspace/entityStore'
import { executeTool as executeCoreTool, TOOL_DEFS as CORE_TOOL_DEFS } from '../../../core/tools/registry'
import { executeTool as executeMainTool, TOOL_DEFS as MAIN_TOOL_DEFS } from '../registry'

describe('desktop tool registry parity', () => {
  it('keeps every tool definition identical to core', () => {
    expect(MAIN_TOOL_DEFS).toEqual(CORE_TOOL_DEFS)
  })

  // 核心与桌面端共享同一份 delete_note 契约：名称、描述、参数 schema 必须逐字一致。
  it('keeps the delete_note definition identical to core', () => {
    const core = CORE_TOOL_DEFS.find((tool) => tool.name === 'delete_note')
    const main = MAIN_TOOL_DEFS.find((tool) => tool.name === 'delete_note')

    expect(core).toBeDefined()
    expect(main).toEqual(core)
  })

  it('keeps the unified delete_entity definition and behavior identical to core', async () => {
    const core = CORE_TOOL_DEFS.find((tool) => tool.name === 'delete_entity')
    const main = MAIN_TOOL_DEFS.find((tool) => tool.name === 'delete_entity')
    expect(core).toBeDefined()
    expect(main).toEqual(core)

    const memory = new MemoryFileStore()
    await initializeWorkspace(memory, '统一删除测试')
    const root = await mkdtemp(join(tmpdir(), 'sf-parity-'))
    try {
      await initializeWorkspace(new NodeFileStore(root), '统一删除测试')
      await memory.writeText('docs/plan.md', '旧计划')
      await new NodeFileStore(root).writeText('docs/plan.md', '旧计划')
      const args = JSON.stringify({ kind: 'projectDoc', id: 'plan.md' })
      const coreOutcome = await executeCoreTool(memory, 'delete_entity', args)
      const mainOutcome = await executeMainTool(root, 'delete_entity', args)
      expect(mainOutcome.kind).toBe('pending')
      expect(coreOutcome.kind).toBe('pending')
      if (coreOutcome.kind !== 'pending' || mainOutcome.kind !== 'pending') throw new Error('未生成待确认删除变更')
      expect(mainOutcome.change).toEqual(expect.objectContaining({
        toolName: 'delete_entity',
        entityKind: coreOutcome.change.entityKind,
        entityId: coreOutcome.change.entityId,
        title: coreOutcome.change.title,
        beforeText: coreOutcome.change.beforeText,
        afterText: coreOutcome.change.afterText
      }))
      expect(await memory.readText('docs/plan.md')).toBe('旧计划')
      expect(await new NodeFileStore(root).readText('docs/plan.md')).toBe('旧计划')
      await mainOutcome.apply()
      expect(await new NodeFileStore(root).readText('docs/plan.md')).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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

  it('restores a note with its own entity kind on both runtimes', async () => {
    const memory = new MemoryFileStore()
    await initializeWorkspace(memory, '测试')
    const root = await mkdtemp(join(tmpdir(), 'sf-parity-'))
    try {
      await initializeWorkspace(new NodeFileStore(root), '测试')

      const coreNote = await saveNote(memory, { title: '恢复测试便签', content: '内容' })
      const coreDelete = await executeCoreTool(memory, 'delete_note', JSON.stringify({ noteId: coreNote.id }))
      if (coreDelete.kind !== 'pending') throw new Error('core 未生成待确认删除')
      await coreDelete.apply()
      const coreRestore = await executeCoreTool(memory, 'restore_from_trash', JSON.stringify({ id: coreNote.id }))

      const mainNote = await saveNote(new NodeFileStore(root), { title: '恢复测试便签', content: '内容' })
      const mainDelete = await executeMainTool(root, 'delete_note', JSON.stringify({ noteId: mainNote.id }))
      if (mainDelete.kind !== 'pending') throw new Error('main 未生成待确认删除')
      await mainDelete.apply()
      const mainRestore = await executeMainTool(root, 'restore_from_trash', JSON.stringify({ id: mainNote.id }))

      if (coreRestore.kind !== 'pending' || mainRestore.kind !== 'pending') throw new Error('恢复未生成待确认变更')
      expect(coreRestore.change.entityKind).toBe('note')
      expect(mainRestore.change.entityKind).toBe(coreRestore.change.entityKind)
      expect(mainRestore.change.title).toBe(coreRestore.change.title)
      expect(mainRestore.change.afterText).toBe(coreRestore.change.afterText)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports the same empty relationship baseline as core', async () => {
    const memory = new MemoryFileStore()
    await initializeWorkspace(memory, '测试')
    const root = await mkdtemp(join(tmpdir(), 'sf-parity-'))
    try {
      await initializeWorkspace(new NodeFileStore(root), '测试')

      const coreFrom = await saveCharacter(memory, { name: '甲' })
      const coreTo = await saveCharacter(memory, { name: '乙' })
      const coreRel = await executeCoreTool(
        memory,
        'save_relationship',
        JSON.stringify({ relationship: { fromCharacterId: coreFrom.id, toCharacterId: coreTo.id, type: '朋友' } })
      )

      const mainFrom = await saveCharacter(new NodeFileStore(root), { name: '甲' })
      const mainTo = await saveCharacter(new NodeFileStore(root), { name: '乙' })
      const mainRel = await executeMainTool(
        root,
        'save_relationship',
        JSON.stringify({ relationship: { fromCharacterId: mainFrom.id, toCharacterId: mainTo.id, type: '朋友' } })
      )

      if (coreRel.kind !== 'pending' || mainRel.kind !== 'pending') throw new Error('未生成待确认关系变更')
      expect(coreRel.change.beforeText).toBe('')
      expect(mainRel.change.beforeText).toBe(coreRel.change.beforeText)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports the same relationship title and error text as core', async () => {
    const memory = new MemoryFileStore()
    await initializeWorkspace(memory, '测试')
    const root = await mkdtemp(join(tmpdir(), 'sf-parity-'))
    try {
      await initializeWorkspace(new NodeFileStore(root), '测试')

      const coreFrom = await saveCharacter(memory, { name: '甲' })
      const coreTo = await saveCharacter(memory, { name: '乙' })
      const mainFrom = await saveCharacter(new NodeFileStore(root), { name: '甲' })
      const mainTo = await saveCharacter(new NodeFileStore(root), { name: '乙' })

      const withType = { relationship: { fromCharacterId: coreFrom.id, toCharacterId: coreTo.id, type: '朋友' } }
      const coreRel = await executeCoreTool(memory, 'save_relationship', JSON.stringify(withType))
      const mainRel = await executeMainTool(
        root,
        'save_relationship',
        JSON.stringify({ relationship: { fromCharacterId: mainFrom.id, toCharacterId: mainTo.id, type: '朋友' } })
      )
      if (coreRel.kind !== 'pending' || mainRel.kind !== 'pending') throw new Error('未生成待确认关系变更')
      expect(mainRel.change.title).toBe(coreRel.change.title)

      const emptyType = await executeCoreTool(
        memory,
        'save_relationship',
        JSON.stringify({ relationship: { fromCharacterId: coreFrom.id, toCharacterId: coreTo.id, type: '' } })
      )
      if (emptyType.kind !== 'pending') throw new Error('空类型未生成待确认关系变更')
      expect(emptyType.change.title).toBe('新增关系：甲 → 乙')

      // 空 type 时 main 也必须不渲染【】：只断言 core 会漏掉主进程回退成无条件后缀的情况
      const mainEmpty = await executeMainTool(
        root,
        'save_relationship',
        JSON.stringify({ relationship: { fromCharacterId: mainFrom.id, toCharacterId: mainTo.id, type: '' } })
      )
      if (mainEmpty.kind !== 'pending') throw new Error('空类型未生成待确认关系变更（main）')
      expect(mainEmpty.change.title).toBe(emptyType.change.title)

      const coreErr = await executeCoreTool(
        memory,
        'save_relationship',
        JSON.stringify({ relationship: { fromCharacterId: 'char_missing', toCharacterId: coreTo.id, type: '朋友' } })
      )
      const mainErr = await executeMainTool(
        root,
        'save_relationship',
        JSON.stringify({ relationship: { fromCharacterId: 'char_missing', toCharacterId: mainTo.id, type: '朋友' } })
      )
      expect(mainErr).toEqual(coreErr)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects moving a chapter to an unknown volume before confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-parity-'))
    try {
      const store = new NodeFileStore(root)
      await initializeWorkspace(store, '测试')
      const chapter = await saveChapter(store, { title: '待移动章节', box: 'draft', content: '内容' })
      const outcome = await executeMainTool(root, 'move_chapter', JSON.stringify({ chapterId: chapter.id, box: 'main', volumeId: 'vol_missing' }))
      expect(outcome.kind).toBe('result')
      if (outcome.kind === 'result') {
        expect(outcome.ok).toBe(false)
        expect(outcome.text).toContain('未找到目标卷')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
