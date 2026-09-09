import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listChapters, listCharacters, listEvents, listNotes, listOutline, listSettings } from '../../workspace/entityStore'
import { executeTool } from '../registry'

interface CreateCase {
  tool: string
  args: unknown
  list: (store: MemoryFileStore) => Promise<Array<{ id: string }>>
}

const CASES: CreateCase[] = [
  { tool: 'save_character', args: { character: { name: '甲' } }, list: listCharacters },
  { tool: 'save_event', args: { event: { title: '事件' } }, list: listEvents },
  { tool: 'save_outline_doc', args: { doc: { title: '总纲', kind: 'total' } }, list: listOutline },
  { tool: 'save_chapter', args: { chapter: { title: '章节', box: 'draft' } }, list: listChapters },
  { tool: 'save_setting', args: { setting: { title: '设定' } }, list: listSettings },
  { tool: 'save_note', args: { note: { title: '便签' } }, list: listNotes }
]

describe('agent create writes', () => {
  it.each(CASES.map((item) => [item.tool, item] as const))('%s 的待确认 entityId 与落盘 id 一致', async (_tool, testCase) => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '测试')

    const outcome = await executeTool(store, testCase.tool, JSON.stringify(testCase.args))
    if (outcome.kind !== 'pending') throw new Error(`未生成待确认变更：${outcome.kind === 'result' ? outcome.text : ''}`)
    const expectedId = outcome.change.entityId
    await outcome.apply()

    const saved = await testCase.list(store)
    expect(saved.map((item) => item.id)).toContain(expectedId)
  })
})
