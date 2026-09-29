import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { saveCharacter, saveEvent, saveNote, saveOutlineDoc, saveSetting, loadCharacterDocuments, loadEventDocuments, loadNoteDocuments, loadOutlineDocuments, loadSettingDocuments } from '../../workspace/entityStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { executeTool, type ToolOutcome } from '../registry'

async function call(store: MemoryFileStore, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  return executeTool(store, name, JSON.stringify(args))
}

function data(outcome: ToolOutcome): any {
  if (outcome.kind !== 'result' || !outcome.ok) throw new Error(outcome.kind === 'result' ? outcome.text : 'expected result')
  return JSON.parse(outcome.text)
}

describe('agent line edits', () => {
  it.each([
    ['character', saveCharacter, loadCharacterDocuments],
    ['event', saveEvent, loadEventDocuments],
    ['outline', saveOutlineDoc, loadOutlineDocuments],
    ['setting', saveSetting, loadSettingDocuments],
    ['note', saveNote, loadNoteDocuments]
  ] as const)('edits only %s body lines and preserves raw metadata', async (kind, save, load) => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '行编辑')
    const doc = await (save as (store: MemoryFileStore, value: any) => Promise<{ id: string }>)(store, { name: '甲', title: '甲', box: 'draft', kind: 'total', content: '第一行\n第二行\n第三行' })
    const item = (await load(store)).find((entry) => entry.doc.id === doc.id)!
    const folder = { character: 'characters', event: 'events', outline: 'outline', setting: 'settings', note: 'notes' }[kind]
    const path = `${folder}/${item.fileName}`
    const before = (await store.readText(path))!
    const read = data(await call(store, 'read_content_lines', { kind, id: doc.id, lineStart: 2, maxLines: 1 }))
    expect(read.lines).toEqual([{ number: 2, text: '第二行' }])
    expect(read.totalLines).toBe(3)
    const pending = await call(store, 'edit_content', { kind, id: doc.id, baseRevision: read.writeRevision, lineStart: 2, lineEnd: 2, replacement: '修订第二行' })
    if (pending.kind !== 'pending') throw new Error(pending.text)
    expect(await store.readText(path)).toBe(before)
    expect((await pending.apply()).ok).toBe(true)
    const after = (await store.readText(path))!
    expect(after).toBe(before.replace('第一行\n第二行\n第三行', '第一行\n修订第二行\n第三行'))
  })

  it('rejects stale revisions, ambiguous text and changes made during approval', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '并发')
    const doc = await saveCharacter(store, { name: '甲', content: '重复\n中间\n重复' })
    const read = data(await call(store, 'read_content_lines', { kind: 'character', id: doc.id }))
    const base = { kind: 'character', id: doc.id, baseRevision: read.writeRevision, replacement: '新内容' }
    const ambiguous = await call(store, 'edit_content', { ...base, expectedText: '重复' })
    expect(ambiguous.kind).toBe('result')
    if (ambiguous.kind === 'result') expect(ambiguous.ok).toBe(false)
    const pending = await call(store, 'edit_content', { ...base, lineStart: 2, lineEnd: 2 })
    if (pending.kind !== 'pending') throw new Error(pending.text)
    await saveCharacter(store, { id: doc.id, content: '用户改过' })
    expect((await pending.apply()).ok).toBe(false)
    const stale = await call(store, 'edit_content', { ...base, lineStart: 2, lineEnd: 2 })
    expect(stale.kind).toBe('result')
    if (stale.kind === 'result') expect(stale.ok).toBe(false)
  })

  it('does not allow the line editor to target front matter', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '元数据边界')
    const doc = await saveSetting(store, { title: '元数据标题', content: '正文内容' })
    const read = data(await call(store, 'read_content_lines', { kind: 'setting', id: doc.id }))
    expect(read.lines).toEqual([{ number: 1, text: '正文内容' }])
    const result = await call(store, 'edit_content', { kind: 'setting', id: doc.id, baseRevision: read.writeRevision, expectedText: '元数据标题', replacement: '篡改' })
    expect(result.kind).toBe('result')
    if (result.kind === 'result') expect(result.ok).toBe(false)
  })

  it('edits a plain docs file and rejects binary or unsafe paths', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/nested/plan.md', '甲\r\n乙\r\n丙')
    await store.writeBytes('docs/book.pdf', new Uint8Array([1, 2, 3]))
    const read = data(await call(store, 'read_content_lines', { kind: 'projectDoc', id: 'nested/plan.md' }))
    const pending = await call(store, 'edit_content', { kind: 'projectDoc', id: 'nested/plan.md', baseRevision: read.writeRevision, expectedText: '乙', replacement: '修改' })
    if (pending.kind !== 'pending') throw new Error(pending.text)
    expect((await pending.apply()).ok).toBe(true)
    expect(await store.readText('docs/nested/plan.md')).toBe('甲\r\n修改\r\n丙')
    for (const id of ['../escape.md', 'book.pdf']) {
      const result = await call(store, 'read_content_lines', { kind: 'projectDoc', id })
      expect(result.kind).toBe('result')
      if (result.kind === 'result') expect(result.ok).toBe(false)
    }
  })

  it('deletes a selected line without changing neighboring lines and previews the exact change', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/lines.txt', '甲\n乙\n丙\n丁')
    const read = data(await call(store, 'read_content_lines', { kind: 'projectDoc', id: 'lines.txt' }))
    const pending = await call(store, 'edit_content', { kind: 'projectDoc', id: 'lines.txt', baseRevision: read.writeRevision, lineStart: 2, lineEnd: 2, replacement: '' })
    if (pending.kind !== 'pending') throw new Error(pending.text)
    expect(pending.change.beforeText).toBe('甲\n乙\n丙\n丁')
    expect(pending.change.afterText).toBe('甲\n丙\n丁')
    expect((await pending.apply()).ok).toBe(true)
    expect(await store.readText('docs/lines.txt')).toBe('甲\n丙\n丁')
  })

  it('rejects mixing pages from different document revisions', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/pages.txt', '第一行\n第二行')
    const first = data(await call(store, 'read_content_lines', { kind: 'projectDoc', id: 'pages.txt', maxLines: 1 }))
    expect(first.nextLine).toBe(2)
    await store.writeText('docs/pages.txt', '第一行\n新的第二行')
    const next = await call(store, 'read_content_lines', { kind: 'projectDoc', id: 'pages.txt', lineStart: first.nextLine, expectedRevision: first.writeRevision })
    expect(next.kind).toBe('result')
    if (next.kind === 'result') expect(next.ok).toBe(false)
  })
})
