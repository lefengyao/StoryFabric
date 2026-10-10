import { describe, expect, it, vi } from 'vitest'
import { makeSafPath, parseSafPath, SafFileStore, type DocumentTreePlugin } from '../safFileStore'

const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments'

function fakePlugin(): DocumentTreePlugin {
  return {
    pickDirectory: vi.fn(),
    stat: vi.fn(async () => ({ exists: false })),
    list: vi.fn(async () => ({ entries: [] })),
    mkdir: vi.fn(async () => undefined),
    read: vi.fn(async () => ({ exists: false })),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined)
  }
}

describe('SAF workspace paths', () => {
  it('round-trips a selected tree and a project folder without treating URI separators as file paths', () => {
    const path = makeSafPath(treeUri, '星海拾遗_123')
    expect(parseSafPath(path)).toEqual({ treeUri, root: '星海拾遗_123' })
    expect(parseSafPath('workspaces/internal')).toBeNull()
  })

  it('rejects escaping the granted tree', async () => {
    const plugin = fakePlugin()
    const store = new SafFileStore(makeSafPath(treeUri, 'project'), plugin)
    await expect(store.readText('../outside')).rejects.toThrow('禁止访问工作区外的路径')
    expect(plugin.read).not.toHaveBeenCalled()
    expect(() => makeSafPath(treeUri, '../outside')).toThrow('无效')
  })

  it('passes relative document paths and text writes to the native tree bridge', async () => {
    const plugin = fakePlugin()
    const store = new SafFileStore(makeSafPath(treeUri, 'project'), plugin)
    await store.writeText('chapters/main/0001.md', '正文')
    expect(plugin.write).toHaveBeenCalledWith({
      treeUri, root: 'project', path: 'chapters/main/0001.md', data: '正文', encoding: 'utf8'
    })
  })

  it('reports malformed UTF-8 to strict readers', async () => {
    const plugin = fakePlugin()
    vi.mocked(plugin.read).mockResolvedValue({ exists: true, data: '/w==' })
    const store = new SafFileStore(makeSafPath(treeUri), plugin)
    await expect(store.readTextStrict('docs/bad.md')).resolves.toEqual({ ok: false, code: 'TEXT_DECODE_ERROR' })
  })

  it('distinguishes native read failures from missing documents', async () => {
    const plugin = fakePlugin()
    vi.mocked(plugin.read).mockRejectedValue(new Error('directory unavailable'))
    const store = new SafFileStore(makeSafPath(treeUri), plugin)
    await expect(store.readTextStrict('docs/entry.md')).resolves.toEqual({ ok: false, code: 'IO_ERROR' })
  })
})
