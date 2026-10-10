import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { getDocumentSnapshot, saveDocument } from '../../workspace/documentWrites'
import { executeDeleteEntityTool } from '../deleteEntityTool'

describe('chapter and outline deletion baselines', () => {
  it.each(['chapter', 'outline'] as const)('preserves an externally edited %s while deletion awaits approval', async (kind) => {
    const store = new MemoryFileStore()
    const document = await saveDocument(store, kind, { title: '等待删除', content: '删除预览原稿' })
    const snapshot = await getDocumentSnapshot(store, kind, document.id)
    const path = kind === 'chapter' ? 'chapters/main/vol_default/0001-等待删除.md' : 'outline/total/0001-等待删除.md'
    const outcome = await executeDeleteEntityTool(store, { kind, id: document.id, baseRevision: snapshot.writeRevision })
    if (outcome.kind !== 'pending') throw new Error('未生成删除确认')
    const changed = snapshot.sourceText.replace('删除预览原稿', '等待期间用户修改的正文')
    await store.writeText(path, changed)

    expect(await outcome.apply()).toMatchObject({ ok: false })
    expect(await store.readText(path)).toBe(changed)
  })

  it.each(['chapter', 'outline'] as const)('waits for an in-flight %s save before checking deletion', async (kind) => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    class PausedSaveStore extends MemoryFileStore {
      pausedPath = ''
      override async readText(path: string): Promise<string | null> {
        if (this.pausedPath === path) {
          this.pausedPath = ''
          entered()
          await gate
        }
        return super.readText(path)
      }
    }
    const store = new PausedSaveStore()
    const document = await saveDocument(store, kind, { title: '保存竞争', content: '原稿' })
    const snapshot = await getDocumentSnapshot(store, kind, document.id)
    const path = kind === 'chapter' ? 'chapters/main/vol_default/0001-保存竞争.md' : 'outline/total/0001-保存竞争.md'
    const outcome = await executeDeleteEntityTool(store, { kind, id: document.id, baseRevision: snapshot.writeRevision })
    if (outcome.kind !== 'pending') throw new Error('未生成删除确认')
    store.pausedPath = path
    const save = saveDocument(store, kind, { id: document.id, content: '成功保存的新稿' }, { baseRevision: snapshot.writeRevision, baseText: snapshot.sourceText })
    await started
    const deletion = outcome.apply()
    // Give the independently queued deletion a chance to run before releasing the save.
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    release()
    await save
    expect(await deletion).toMatchObject({ ok: false })
    expect((await getDocumentSnapshot(store, kind, document.id)).document.content).toContain('成功保存的新稿')
  })
})
