import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { migrateWorkspace, validateCurrentDocumentFormat } from '../migration'
import { loadSummary } from '../workspaceService'
import { parseFrontMatter } from '../frontMatter'
import { bytesContentRevision } from '../resourceRevision'
import { pendingMutationJournals } from '../mutationJournal'
import { restoreFromTrash } from '../trash'

const rootRaw = '{\r\n  "app": "storyfabric",\r\n  "version": 4,\r\n  "name": "旧作品",\r\n  "createdAt": "2024-02-03T04:05:06.000Z",\r\n  "custom": { "theme": "星港", "values": [1, 2] }\r\n}\r\n'
const chapterPath = 'chapters/draft/0003-旧草稿.md'
const chapterRaw = '\uFEFF---\r\nid: cha_legacy\r\ntitle: 旧草稿\r\nvolume: 星港卷\r\nvolumeId: vol_legacy\r\nbox: draft\r\nstatus: revised\r\norder: 3\r\nterms:\r\n  - term: 星港\r\n    note: 旧注释\r\ncustom: {flag: true}\r\n---\r\n\r\n不自动缩进的正文。\r\n  保留空格\r\n\r\n'
const outlinePath = 'outline/chapters/cha_legacy/0001-旧章纲.md'
const outlineRaw = '---\n id: out_legacy\n title: 旧章纲\n order: 1\n kind: chapter\n chapterId: cha_legacy\n extra: [a, b]\n---\n\n# 原来的标题\n\n旧纲内容\n'

async function seed(store: MemoryFileStore): Promise<void> {
  await store.writeText('storyfabric.json', rootRaw)
  await store.writeText('chapters/volumes.json', '[{"id":"vol_legacy","title":"星港卷","order":1}]')
  await store.writeText(chapterPath, chapterRaw)
  await store.writeText(outlinePath, outlineRaw)
  await store.writeText('characters/primary/角色.md', '原人物资料')
  await store.writeText('relationships.json', '[{"id":"rel_keep","fromId":"char_a","toId":"char_b"}]')
}

describe('explicit format-4 workspace upgrade', () => {
  it('requires opt-in without modifying any originals', async () => {
    const store = new MemoryFileStore()
    await seed(store)
    await expect(migrateWorkspace(store)).rejects.toThrow('WORKSPACE_UPGRADE_REQUIRED')
    expect(await store.readText('storyfabric.json')).toBe(rootRaw)
    expect(await store.readText(chapterPath)).toBe(chapterRaw)
    expect(await store.listDirs('.storyfabric/format-backups')).toEqual([])
  })

  it('backs up exact originals and upgrades metadata while preserving raw bodies, IDs and associations', async () => {
    const store = new MemoryFileStore()
    await seed(store)
    await migrateWorkspace(store, { upgradeLegacy: true })
    const metadata = JSON.parse((await store.readText('storyfabric.json'))!)
    expect(metadata).toEqual({ ...JSON.parse(rootRaw), version: 5 })
    const chapter = parseFrontMatter((await store.readText(chapterPath))!)
    const outline = parseFrontMatter((await store.readText(outlinePath))!)
    expect(chapter.content).toBe(parseFrontMatter(chapterRaw).content)
    expect(outline.content).toBe(parseFrontMatter(outlineRaw).content)
    expect(chapter.data).toMatchObject({ ...parseFrontMatter(chapterRaw).data, writeRevision: expect.stringMatching(/^wr_/), updatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/) })
    expect(outline.data).toMatchObject({ ...parseFrontMatter(outlineRaw).data, writeRevision: expect.stringMatching(/^wr_/), updatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/) })
    const backupIds = await store.listDirs('.storyfabric/format-backups')
    expect(backupIds).toHaveLength(1)
    const backupRoot = `.storyfabric/format-backups/${backupIds[0]}`
    const manifest = JSON.parse((await store.readText(`${backupRoot}/manifest.json`))!)
    expect(manifest).toMatchObject({ schemaVersion: 1, fromVersion: 4, toVersion: 5 })
    expect(manifest.files).toHaveLength(3)
    for (const file of manifest.files) {
      const expected = file.path === 'storyfabric.json' ? rootRaw : file.path === chapterPath ? chapterRaw : outlineRaw
      const bytes = await store.readBytes(file.backupPath)
      expect(bytes).toEqual(new TextEncoder().encode(expected))
      expect(file.checksum).toBe(bytesContentRevision(bytes!))
    }
    expect(await store.readText('characters/primary/角色.md')).toBe('原人物资料')
    expect(await store.readText('relationships.json')).toContain('rel_keep')
    expect(await store.listDirs('.storyfabric/history/chapters')).toEqual([])
    expect(await store.listDirs('.storyfabric/history/outlines')).toEqual([])
    const firstRevision = chapter.data.writeRevision
    await migrateWorkspace(store, { upgradeLegacy: true })
    expect(await store.listDirs('.storyfabric/format-backups')).toEqual(backupIds)
    expect(parseFrontMatter((await store.readText(chapterPath))!).data.writeRevision).toBe(firstRevision)
  })

  it('rolls back backup and current files when a later conversion write fails, permitting clean retry', async () => {
    class FailingStore extends MemoryFileStore {
      fail = false
      override async writeText(path: string, text: string): Promise<void> {
        if (this.fail && path === outlinePath && text.includes('writeRevision:')) { this.fail = false; throw new Error('upgrade disk full') }
        await super.writeText(path, text)
      }
    }
    const store = new FailingStore()
    await seed(store)
    store.fail = true
    await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('upgrade disk full')
    expect(await store.readText('storyfabric.json')).toBe(rootRaw)
    expect(await store.readText(chapterPath)).toBe(chapterRaw)
    expect(await store.readText(outlinePath)).toBe(outlineRaw)
    expect(await store.listDirs('.storyfabric/format-backups')).toEqual([])
    expect(await pendingMutationJournals(store)).toEqual([])
    await migrateWorkspace(store, { upgradeLegacy: true })
    expect(JSON.parse((await store.readText('storyfabric.json'))!).version).toBe(5)
    expect(await store.listDirs('.storyfabric/format-backups')).toHaveLength(1)
  })

  it('retains all original backups if a current-file rollback fails and blocks retry until recovery', async () => {
    class RollbackFailureStore extends MemoryFileStore {
      fail = false
      override async writeText(path: string, text: string): Promise<void> {
        if (this.fail && path === outlinePath && text.includes('writeRevision:')) throw new Error('conversion failed')
        if (this.fail && path === chapterPath && text === chapterRaw) throw new Error('rollback failed')
        await super.writeText(path, text)
      }
    }
    const store = new RollbackFailureStore()
    await seed(store)
    store.fail = true
    await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('RECOVERY_REQUIRED')
    const backups = await store.listDirs('.storyfabric/format-backups')
    expect(backups).toHaveLength(1)
    const root = `.storyfabric/format-backups/${backups[0]}`
    expect(await store.readText(`${root}/storyfabric.json`)).toBe(rootRaw)
    expect(await store.readText(`${root}/${chapterPath}`)).toBe(chapterRaw)
    expect(await store.readText(`${root}/${outlinePath}`)).toBe(outlineRaw)
    expect(await store.readText('storyfabric.json')).toBe(rootRaw)
    expect((await pendingMutationJournals(store))[0].status).toBe('recovery_required')
    const interruptedChapter = await store.readText(chapterPath)
    store.fail = false
    await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('RECOVERY_REQUIRED')
    expect(await store.readText(chapterPath)).toBe(interruptedChapter)
    expect(await store.listDirs('.storyfabric/format-backups')).toEqual(backups)
  })

  it('blocks interrupted or damaged upgrade journals before touching legacy sources', async () => {
    for (const journal of ['{"version":1,"id":"workspace-upgrade-interrupted","status":"prepared","changes":[]}', 'damaged journal']) {
      const store = new MemoryFileStore()
      await seed(store)
      await store.writeText('.storyfabric/transactions/workspace-upgrade-interrupted.json', journal)
      await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('RECOVERY_REQUIRED')
      expect(await store.readText('storyfabric.json')).toBe(rootRaw)
      expect(await store.readText(chapterPath)).toBe(chapterRaw)
      expect(await store.listDirs('.storyfabric/format-backups')).toEqual([])
    }
  })

  it('rolls back converted documents when creating missing volume metadata fails', async () => {
    class MissingVolumeFailureStore extends MemoryFileStore {
      override async writeText(path: string, text: string): Promise<void> {
        if (path === 'chapters/volumes.json') throw new Error('volume write failed')
        await super.writeText(path, text)
      }
    }
    const store = new MissingVolumeFailureStore()
    await store.writeText('storyfabric.json', rootRaw)
    await store.writeText(chapterPath, chapterRaw)
    await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('volume write failed')
    expect(await store.readText('storyfabric.json')).toBe(rootRaw)
    expect(await store.readText(chapterPath)).toBe(chapterRaw)
    expect(await store.exists('chapters/volumes.json')).toBe(false)
    expect(await store.listDirs('.storyfabric/format-backups')).toEqual([])
  })

  it('rejects malformed root metadata without creating backups or changing source documents', async () => {
    for (const raw of ['null', '[]', '{"app":"storyfabric","version":4.5}', '{"app":"storyfabric","version":1e400}']) {
      const store = new MemoryFileStore()
      await seed(store)
      await store.writeText('storyfabric.json', raw)
      await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('元数据无效')
      expect(await store.readText('storyfabric.json')).toBe(raw)
      expect(await store.readText(chapterPath)).toBe(chapterRaw)
      expect(await store.listDirs('.storyfabric/format-backups')).toEqual([])
    }
  })

  it('backs up a UTF-8 BOM root file exactly', async () => {
    const store = new MemoryFileStore()
    await seed(store)
    await store.writeText('storyfabric.json', `\uFEFF${rootRaw}`)
    await migrateWorkspace(store, { upgradeLegacy: true })
    const [id] = await store.listDirs('.storyfabric/format-backups')
    expect(await store.readBytes(`.storyfabric/format-backups/${id}/storyfabric.json`)).toEqual(new TextEncoder().encode(`\uFEFF${rootRaw}`))
  })

  it('upgrades and backs up deleted documents so later restoration remains valid format 5', async () => {
    const store = new MemoryFileStore()
    await seed(store)
    const deletedPath = '.storyfabric/trash/chapter/cha_deleted.md'
    const originalPath = 'chapters/draft/0004-已删除.md'
    const deletedRaw = chapterRaw.replace('cha_legacy', 'cha_deleted')
    await store.writeText(deletedPath, deletedRaw)
    await store.writeText('.storyfabric/trash/index.json', JSON.stringify([{ id: 'cha_deleted', kind: 'chapter', title: '已删除', deletedAt: 1, originalPath }]))
    await migrateWorkspace(store, { upgradeLegacy: true })
    const [id] = await store.listDirs('.storyfabric/format-backups')
    expect(await store.readText(`.storyfabric/format-backups/${id}/${deletedPath}`)).toBe(deletedRaw)
    await restoreFromTrash(store, 'cha_deleted')
    const restored = (await store.readText(originalPath))!
    expect(() => validateCurrentDocumentFormat(originalPath, restored)).not.toThrow()
    expect(parseFrontMatter(restored).content).toBe(parseFrontMatter(deletedRaw).content)
    expect(await store.listDirs('.storyfabric/history/chapters')).toEqual([])
    await migrateWorkspace(store)
  })

  it('repairs stale format-4 chapter statuses to active and trash restoration paths without moving originals', async () => {
    const store = new MemoryFileStore()
    await seed(store)
    const mainPath = 'chapters/main/vol_legacy/0004-正文旧状态.md'
    const mainRaw = chapterRaw.replace('cha_legacy', 'cha_main').replace('status: revised', 'status: draft')
    const draftPath = 'chapters/draft/0005-草稿旧状态.md'
    const draftRaw = chapterRaw.replace('cha_legacy', 'cha_draft').replace('status: revised', 'status: final')
    const trashPath = '.storyfabric/trash/chapter/cha_deleted_stale.md'
    const deletedRaw = chapterRaw.replace('cha_legacy', 'cha_deleted_stale').replace('status: revised', 'status: draft')
    const restoredPath = 'chapters/main/vol_legacy/0006-回收旧状态.md'
    await store.writeText(mainPath, mainRaw)
    await store.writeText(draftPath, draftRaw)
    await store.writeText(trashPath, deletedRaw)
    await store.writeText('.storyfabric/trash/index.json', JSON.stringify([{ id: 'cha_deleted_stale', kind: 'chapter', title: '回收旧状态', deletedAt: 1, originalPath: restoredPath, trashPath }]))
    await migrateWorkspace(store, { upgradeLegacy: true })
    const [backupId] = await store.listDirs('.storyfabric/format-backups')
    const root = `.storyfabric/format-backups/${backupId}`
    for (const [path, raw, status, box] of [[mainPath, mainRaw, 'body', 'main'], [draftPath, draftRaw, 'draft', 'draft'], [trashPath, deletedRaw, 'body', 'main']]) {
      expect(await store.readText(`${root}/${path}`)).toBe(raw)
      const converted = parseFrontMatter((await store.readText(path))!)
      expect(converted.content).toBe(parseFrontMatter(raw).content)
      expect(converted.data).toMatchObject({ status, box, volumeId: 'vol_legacy' })
    }
    await restoreFromTrash(store, 'cha_deleted_stale')
    const restored = (await store.readText(restoredPath))!
    expect(() => validateCurrentDocumentFormat(restoredPath, restored)).not.toThrow()
    expect(parseFrontMatter(restored).content).toBe(parseFrontMatter(deletedRaw).content)
    expect(await store.listDirs('.storyfabric/history/chapters')).toEqual([])
    await migrateWorkspace(store)
  })

  it('rejects duplicate IDs and conflicting valid associations before creating backups', async () => {
    const cases = [
      ['chapters/draft/duplicate.md', chapterRaw],
      ['chapters/main/vol_other/conflict.md', chapterRaw.replace('cha_legacy', 'cha_conflict').replace('status: revised', 'status: body')],
      ['outline/chapters/cha_other/conflict.md', outlineRaw.replace('out_legacy', 'out_conflict')]
    ]
    for (const [path, raw] of cases) {
      const store = new MemoryFileStore()
      await seed(store)
      await store.writeText(path, raw)
      await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow(/重复文档 ID|关联与所在目录冲突/)
      expect(await store.readText('storyfabric.json')).toBe(rootRaw)
      expect(await store.listDirs('.storyfabric/format-backups')).toEqual([])
    }
  })

  it('validates all legacy documents before creating backups and rejects earlier formats', async () => {
    const store = new MemoryFileStore()
    await seed(store)
    await store.writeText('outline/unassigned/invalid.md', '缺少元数据的大纲')
    await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('元数据')
    expect(await store.listDirs('.storyfabric/format-backups')).toEqual([])
    expect(await store.readText('storyfabric.json')).toBe(rootRaw)
    await store.writeText('storyfabric.json', rootRaw.replace('"version": 4', '"version": 3'))
    await expect(migrateWorkspace(store, { upgradeLegacy: true })).rejects.toThrow('格式 5')
    expect(await store.readText(chapterPath)).toBe(chapterRaw)
  })

  it('opens an opted-in legacy workspace through shared loadSummary', async () => {
    const store = new MemoryFileStore()
    await seed(store)
    const summary = await loadSummary(store, '默认名', 'memory://legacy', { upgradeLegacy: true })
    expect(summary).toMatchObject({ name: '旧作品', version: 5 })
    expect(summary.chapters.map((chapter) => chapter.id)).toEqual(['cha_legacy'])
    expect(summary.outline[0].chapterId).toBe('cha_legacy')
  })
})
