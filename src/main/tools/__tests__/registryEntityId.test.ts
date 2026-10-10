import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { NodeFileStore } from '../../../core/storage/nodeFileStore'
import { initializeWorkspace } from '../../../core/workspace/workspaceService'
import { listChapters, listCharacters, listEvents, listNotes, listOutline, listSettings } from '../../../core/workspace/entityStore'
import { executeTool } from '../registry'

interface CreateCase {
  tool: string
  args: unknown
  list: (store: NodeFileStore) => Promise<Array<{ id: string }>>
}

const CASES: CreateCase[] = [
  { tool: 'save_character', args: { character: { name: '甲' } }, list: listCharacters },
  { tool: 'save_event', args: { event: { title: '事件', volumeId: 'vol_default' } }, list: listEvents },
  { tool: 'save_outline_doc', args: { doc: { title: '总纲', kind: 'total' } }, list: listOutline },
  { tool: 'save_chapter', args: { chapter: { title: '章节', box: 'draft' } }, list: listChapters },
  { tool: 'save_setting', args: { setting: { title: '设定' } }, list: listSettings },
  { tool: 'save_note', args: { note: { title: '便签' } }, list: listNotes }
]

describe('desktop create writes', () => {
  it.each(CASES.map((item) => [item.tool, item] as const))('%s 的待确认 entityId 与落盘 id 一致', async (_tool, testCase) => {
    const root = await mkdtemp(join(tmpdir(), 'sf-entityid-'))
    try {
      const store = new NodeFileStore(root)
      await initializeWorkspace(store, '测试')

      const outcome = await executeTool(root, testCase.tool, JSON.stringify(testCase.args))
      if (outcome.kind !== 'pending') throw new Error(`未生成待确认变更：${outcome.kind === 'result' ? outcome.text : ''}`)
      const expectedId = outcome.change.entityId
      expect((await outcome.apply({ saveHistory: false })).ok).toBe(true)

      const saved = await testCase.list(new NodeFileStore(root))
      expect(saved.map((item) => item.id)).toContain(expectedId)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
