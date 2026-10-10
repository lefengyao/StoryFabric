import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { HistoryVersion, HistoryVersionRecord } from '../../../../../shared/documentHistory'
import type { WorkspaceSummary } from '../../../../../shared/types'
import { buildHistoryEntities, historySourceLabel } from '../historyView'
import { HistoryContent } from '../HistoryContent'

const summary = { name: '作品', path: 'test', chapters: [{ id: 'draft', title: '草稿', box: 'draft', volumeId: 'v1' }, { id: 'body', title: '正文', box: 'main', volumeId: 'v2' }], outline: [{ id: 'total', title: '总纲', kind: 'total' }, { id: 'linked', title: '关联', kind: 'chapter', chapterId: 'body' }, { id: 'alone', title: '独立', kind: 'chapter' }] } as WorkspaceSummary
const version = { historyVersionId: 'hv_test', historySequence: 12, entityKind: 'chapter', entityId: 'deleted', title: '原文档标题', source: 'automatic', createdAt: '2026-10-09T02:00:00.000Z', pinned: true, label: '', note: '', wordCount: 3 } as HistoryVersion
describe('history document selection', () => {
  it('discovers deleted documents from metadata and keeps their history readable', () => {
    const entities = buildHistoryEntities('chapter', [version], summary, {})
    expect(entities.find((entity) => entity.id === 'deleted')).toMatchObject({ title: '原文档标题', deleted: true, versionCount: 1 })
  })
  it('filters draft/body boxes and volumes without hiding orphaned history', () => {
    expect(buildHistoryEntities('chapter', [version], summary, { box: 'draft' }).map((entity) => entity.id)).toEqual(['draft', 'deleted'])
    expect(buildHistoryEntities('chapter', [], summary, { box: 'main', volumeId: 'v2' }).map((entity) => entity.id)).toEqual(['body'])
  })
  it('treats total, associated, and unassigned outlines as selectable documents', () => {
    expect(buildHistoryEntities('outline', [], summary, { outlineKind: 'total' }).map((entity) => entity.id)).toEqual(['total'])
    expect(buildHistoryEntities('outline', [], summary, { outlineKind: 'chapter', chapterId: '__unassigned__' }).map((entity) => entity.id)).toEqual(['alone'])
    expect(buildHistoryEntities('outline', [], summary, { outlineKind: 'chapter', chapterId: 'body' }).map((entity) => entity.id)).toEqual(['linked'])
  })
})
describe('readonly history content', () => {
  const record = { ...version, document: { id: 'deleted', title: '原文档标题', content: '第一段\n\n最后一段 **完整正文**' } } as HistoryVersionRecord
  it('renders full markdown without an editable input', () => {
    const html = renderToStaticMarkup(<HistoryContent record={record} />)
    expect(html).toContain('第一段')
    expect(html).toContain('最后一段')
    expect(html).toContain('<strong>完整正文</strong>')
    expect(html).not.toContain('textarea')
    expect(html).toContain('data-history-readonly="true"')
  })
  it('shows additions and removals when comparing another revision', () => {
    const html = renderToStaticMarkup(<HistoryContent record={record} compare={{ ...record.document, content: '另一版正文' }} />)
    expect(html).toContain('另一版正文')
    expect(html).toContain('完整正文')
    expect(html).toContain('data-diff-change="removed"')
    expect(html).toContain('data-diff-change="added"')
  })
  it('uses explicit product labels for automatic and recovery sources', () => {
    expect(historySourceLabel('automatic')).toBe('五分钟自动留存')
    expect(historySourceLabel('before-restore')).toBe('恢复前保护')
  })
})
