import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../archive'
import { MemoryFileStore } from '../../storage/fileStore'
import { purgeTrashEntry } from '../trash'
import { parseFrontMatter } from '../frontMatter'
import { bytesContentRevision } from '../resourceRevision'

async function zipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, value] of Object.entries(files)) zip.file(path, value)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('workspace archive', () => {
  it('exports and imports a portable workspace zip', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '测试项目' }))
    await source.writeText('characters/林晚.md', '# 林晚')
    const archive = await exportWorkspaceArchive(source, '测试项目')
    expect(archive.fileName).toBe('测试项目.storyfabric.zip')

    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)
    expect(await target.readText('storyfabric.json')).toContain('storyfabric')
    expect(await target.readText('characters/林晚.md')).toBe('# 林晚')
  })

  it('keeps only the portable layout runtime file and excludes other runtime data', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '测试项目' }))
    await source.writeText('.storyfabric/layout.json', JSON.stringify({ char_1: { x: 1, y: 2 } }))
    await source.writeText('.storyfabric/memory.md', '---\nenabled: true\n---\n- 项目偏好')
    await source.writeText('.storyfabric/sessions/sess_1.json', JSON.stringify({ id: 'sess_1', title: '测试会话' }))
    await source.writeText('.storyfabric/trash/index.json', JSON.stringify([{ id: 'char_1' }]))
    await source.writeText('.storyfabric/index.json', JSON.stringify({ derived: true }))

    const archive = await exportWorkspaceArchive(source, '测试项目')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)

    expect(await target.readText('.storyfabric/layout.json')).not.toBeNull()
    expect(await target.readText('.storyfabric/memory.md')).toContain('项目偏好')
    expect(await target.readText('.storyfabric/sessions/sess_1.json')).toBeNull()
    expect(await target.readText('.storyfabric/trash/index.json')).toBeNull()
    expect(await target.readText('.storyfabric/index.json')).toBeNull()
  })

  it('round-trips creative configuration and validated package files but excludes run data', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '创作扩展' }))
    await source.writeText('.storyfabric/creative/config.json', '{"enabled":true}')
    await source.writeText('.storyfabric/creative/packages/storyfabric.demo/1.0.0/manifest.json', '{"schemaVersion":1}')
    await source.writeText('.storyfabric/runs/r1/snapshot.json', '{"status":"completed"}')
    const archive = await exportWorkspaceArchive(source, '创作扩展')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)
    expect(await target.readText('.storyfabric/creative/config.json')).toBe('{"enabled":true}')
    expect(await target.readText('.storyfabric/creative/packages/storyfabric.demo/1.0.0/manifest.json')).toBe('{"schemaVersion":1}')
    expect(await target.readText('.storyfabric/runs/r1/snapshot.json')).toBeNull()
  })

  it('keeps docs backup files byte-for-byte', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '文档备份' }))
    await source.writeBytes('docs/plan.md.bak', new Uint8Array([0, 255, 1]))
    await source.writeText('characters/old.md.bak', '不应导出')
    const archive = await exportWorkspaceArchive(source, '文档备份')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)
    expect(await target.readBytes('docs/plan.md.bak')).toEqual(new Uint8Array([0, 255, 1]))
    expect(await target.readText('characters/old.md.bak')).toBeNull()
  })

  it('requires explicit legacy ZIP upgrade before writing and backs up exact original bytes', async () => {
    const metadata = '\uFEFF{\r\n"app":"storyfabric","version":4,"name":"旧作品","custom":{"keep":true}\r\n}\r\n'
    const chapterPath = 'chapters/main/vol_default/0001-旧章节.md'
    const chapter = '\uFEFF---\r\nid: cha_legacy\r\ntitle: 旧章节\r\nvolumeId: vol_default\r\nbox: main\r\nstatus: body\r\norder: 1\r\ncustom: legacy\r\n---\r\n\r\n旧正文原样保留。\r\n  缩进与空行\r\n\r\n'
    const bytes = await zipBytes({ 'storyfabric.json': metadata, [chapterPath]: chapter })
    const denied = new MemoryFileStore()
    await expect(importWorkspaceArchive(denied, bytes)).rejects.toThrow('WORKSPACE_UPGRADE_REQUIRED')
    expect(await denied.listFiles('')).toEqual([])
    expect(await denied.listDirs('')).toEqual([])

    const imported = new MemoryFileStore()
    await importWorkspaceArchive(imported, bytes, { upgradeLegacy: true })
    expect(JSON.parse((await imported.readText('storyfabric.json'))!)).toEqual({ app: 'storyfabric', version: 5, name: '旧作品', custom: { keep: true } })
    expect(parseFrontMatter((await imported.readText(chapterPath))!).content).toBe(parseFrontMatter(chapter).content)
    const [backupId] = await imported.listDirs('.storyfabric/format-backups')
    const root = `.storyfabric/format-backups/${backupId}`
    expect(await imported.readBytes(`${root}/storyfabric.json`)).toEqual(new TextEncoder().encode(metadata))
    expect(await imported.readBytes(`${root}/${chapterPath}`)).toEqual(new TextEncoder().encode(chapter))
    expect(await imported.listDirs('.storyfabric/history/chapters')).toEqual([])

    const archive = await exportWorkspaceArchive(imported, '旧作品')
    const copied = new MemoryFileStore()
    await importWorkspaceArchive(copied, archive.bytes)
    expect(await copied.readBytes(`${root}/storyfabric.json`)).toEqual(new TextEncoder().encode(metadata))
    expect(await copied.readBytes(`${root}/${chapterPath}`)).toEqual(new TextEncoder().encode(chapter))
    expect(await copied.readBytes(`${root}/manifest.json`)).toEqual(await imported.readBytes(`${root}/manifest.json`))
    const copiedChapter = (await copied.readText(chapterPath))!
    expect(copiedChapter.startsWith('\uFEFF---\r\n')).toBe(true)
    expect(parseFrontMatter(copiedChapter).content).toBe(parseFrontMatter(chapter).content)
    const manifest = JSON.parse(new TextDecoder().decode((await copied.readBytes(`${root}/manifest.json`))!))
    const backedChapter = manifest.files.find((file: { path: string }) => file.path === chapterPath)
    expect(backedChapter.checksum).toBe(bytesContentRevision((await copied.readBytes(backedChapter.backupPath))!))
    expect(parseFrontMatter((await copied.readText(chapterPath))!).data.writeRevision).not.toBe(parseFrontMatter((await imported.readText(chapterPath))!).data.writeRevision)
  })

  it('round-trips immutable format backups and historical snapshots without rotating either', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', '{"app":"storyfabric","version":5}')
    const historyPath = '.storyfabric/history/chapters/cha_legacy/versions/hv_original.json'
    const backupRoot = '.storyfabric/format-backups/fb_original'
    await source.writeText(historyPath, '{"historyVersionId":"hv_original","historySequence":9,"createdAt":123,"document":{"id":"cha_legacy","content":"历史正文"}}')
    await source.writeText('.storyfabric/history/chapters/cha_legacy/manifest.json', '{"nextSequence":10,"versions":["hv_original"]}')
    await source.writeBytes(`${backupRoot}/chapters/draft/原稿.md`, new Uint8Array([239, 187, 191, 0, 255, 10]))
    await source.writeText(`${backupRoot}/.storyfabric/trash/chapter/cha_deleted.md`, '未转换的回收原稿')
    await source.writeText(`${backupRoot}/manifest.json`, '{"schemaVersion":1,"backupId":"fb_original"}')
    await source.writeText('.storyfabric/transactions/pending.json', '{"status":"prepared"}')
    const archive = await exportWorkspaceArchive(source, '备份')
    const copied = new MemoryFileStore()
    await importWorkspaceArchive(copied, archive.bytes)
    expect(await copied.readBytes(`${backupRoot}/chapters/draft/原稿.md`)).toEqual(new Uint8Array([239, 187, 191, 0, 255, 10]))
    expect(await copied.readBytes(`${backupRoot}/.storyfabric/trash/chapter/cha_deleted.md`)).toEqual(new TextEncoder().encode('未转换的回收原稿'))
    expect(await copied.readText(historyPath)).toBe(await source.readText(historyPath))
    expect(await copied.readText('.storyfabric/transactions/pending.json')).toBeNull()
  })

  it('rejects imported trash and arbitrary runtime files before writing', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({
      'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 5, name: '测试' }),
      '.storyfabric/trash/index.json': '[]'
    })

    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('.storyfabric/trash/index.json')
    expect(await target.listFiles('')).toEqual([])
  })

  it('ignores a malformed trash entry whose empty path could otherwise target the workspace root', async () => {
    const target = new MemoryFileStore()
    await target.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '安全项目' }))
    await target.writeText('.storyfabric/trash/index.json', JSON.stringify([{
      id: 'bad', kind: 'note', originalPath: 'notes/bad.md', trashPath: '', deletedAt: 1, title: '恶意条目'
    }]))

    await purgeTrashEntry(target, 'bad')
    expect(await target.readText('storyfabric.json')).toContain('安全项目')
  })

  it('refuses to import into an existing workspace without changing it', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '导入源' }))
    const archive = await exportWorkspaceArchive(source, '导入源')
    const target = new MemoryFileStore()
    await target.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '原项目' }))

    await expect(importWorkspaceArchive(target, archive.bytes)).rejects.toThrow('目标工作区必须为空')
    expect(await target.readText('storyfabric.json')).toContain('原项目')
  })

  it('rejects unsafe and unsupported ZIP entries before writing', async () => {
    const validMetadata = JSON.stringify({ app: 'storyfabric', version: 5, name: '测试' })
    const cases: Array<Record<string, string>> = [
      { '../escape.md': 'nope', 'storyfabric.json': validMetadata },
      { '/escape.md': 'nope', 'storyfabric.json': validMetadata },
      { 'secret.txt': 'nope', 'storyfabric.json': validMetadata },
      { 'storyfabric.json': '{"app":"other","version":2}' }
    ]

    for (const files of cases) {
      const target = new MemoryFileStore()
      await expect(importWorkspaceArchive(target, await zipBytes(files))).rejects.toThrow()
      expect(await target.listFiles('')).toEqual([])
    }
  })

  it('rejects paths that collide on case-insensitive filesystems', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({
      'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 5, name: '测试' }),
      'characters/A.md': '# A',
      'characters/a.md': '# a'
    })
    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('冲突路径')
    expect(await target.listFiles('')).toEqual([])
  })

  it('rejects archives created by a newer workspace version', async () => {
    const target = new MemoryFileStore()
    const bytes = await zipBytes({ 'storyfabric.json': JSON.stringify({ app: 'storyfabric', version: 999, name: '未来项目' }) })
    await expect(importWorkspaceArchive(target, bytes)).rejects.toThrow('有效')
  })
})
