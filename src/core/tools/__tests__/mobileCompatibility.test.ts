import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { getChapterBody, saveChapter } from '../../workspace/entityStore'
import { listHistoryVersions } from '../../history/historyService'
import { AgentRuntime } from '../../agent/runtime'
import { executeTool } from '../registry'

describe('older Android WebView compatibility', () => {
  it.each([false, true])('appends an existing chapter with saveHistory=%s when Array.at is unavailable', async (saveHistory) => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '移动端续写')
    const chapter = await saveChapter(store, { title: '第一章', box: 'draft', content: '原有正文' })
    const read = await executeTool(store, 'get_chapter', JSON.stringify({ chapterId: chapter.id }))
    if (read.kind !== 'result' || !read.ok) throw new Error('章节读取失败')
    const source = JSON.parse(read.text) as { writeRevision: string; readRevision: string }
    const pending = await executeTool(store, 'append_chapter', JSON.stringify({ chapterId: chapter.id, baseRevision: source.writeRevision, baseReadRevision: source.readRevision, appendText: '新增正文' }))
    if (pending.kind !== 'pending') throw new Error(pending.text)
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'at')!
    let result: { ok: boolean; text: string }
    try {
      Object.defineProperty(Array.prototype, 'at', { ...descriptor, value: undefined })
      result = await pending.apply({ saveHistory })
    } finally { Object.defineProperty(Array.prototype, 'at', descriptor) }
    expect(result.ok, result.text).toBe(true)
    expect(await getChapterBody(store, chapter.id)).toContain('新增正文')
    expect(await listHistoryVersions(store, 'chapter', chapter.id)).toHaveLength(saveHistory ? 2 : 0)
  })

  it('starts and snapshots an agent run without native structuredClone', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')!
    const runtime = new AgentRuntime({ idFactory: () => 'run-mobile' })
    let error: unknown
    let snapshot: ReturnType<AgentRuntime['getSnapshot']>
    try {
      Object.defineProperty(globalThis, 'structuredClone', { ...descriptor, value: undefined })
      const started = runtime.start({ workspaceId: 'w', sessionId: 's', agentId: 'basic' }, (context) => context.text('message', '章节正文'))
      await started.done
      snapshot = runtime.getSnapshot(started.runId)
    } catch (caught) { error = caught }
    finally { Object.defineProperty(globalThis, 'structuredClone', descriptor) }
    expect(error).toBeUndefined()
    expect(snapshot!).toMatchObject({ status: 'completed', drafts: [{ messageId: 'message', text: '章节正文' }] })
  })
})
