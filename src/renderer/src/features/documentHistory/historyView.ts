import type { DocumentKind, HistorySource, HistoryVersion } from '../../../../shared/documentHistory'
import type { WorkspaceSummary } from '../../../../shared/types'
export interface HistoryEntity { id: string; title: string; deleted: boolean; versionCount: number }
export interface HistoryFilters { box?: string; volumeId?: string; outlineKind?: string; chapterId?: string }
export function buildHistoryEntities(kind: DocumentKind, versions: HistoryVersion[], summary: WorkspaceSummary | null, filters: HistoryFilters): HistoryEntity[] {
  const current = kind === 'chapter' ? summary?.chapters ?? [] : summary?.outline ?? []
  const counts = new Map<string, number>()
  const latest = new Map<string, HistoryVersion>()
  for (const version of versions) {
    counts.set(version.entityId, (counts.get(version.entityId) ?? 0) + 1)
    if (!latest.has(version.entityId) || latest.get(version.entityId)!.historySequence < version.historySequence) latest.set(version.entityId, version)
  }
  const ids = new Set(current.map((document) => document.id))
  const entities = current.filter((document) => {
    if (kind === 'chapter') {
      const chapter = document as WorkspaceSummary['chapters'][number]
      return (!filters.box || (chapter.box ?? 'main') === filters.box) && (!filters.volumeId || (chapter.volumeId ?? 'vol_default') === filters.volumeId)
    }
    const outline = document as WorkspaceSummary['outline'][number]
    return (!filters.outlineKind || (outline.kind ?? 'total') === filters.outlineKind)
      && (!filters.chapterId || (filters.chapterId === '__unassigned__' ? !outline.chapterId : outline.chapterId === filters.chapterId))
  }).map((document) => ({ id: document.id, title: document.title, deleted: false, versionCount: counts.get(document.id) ?? 0 }))
  for (const [id, version] of latest) if (!ids.has(id)) entities.push({ id, title: version.title, deleted: true, versionCount: counts.get(id) ?? 0 })
  return entities
}
export function historySourceLabel(source: HistorySource): string {
  return ({ manual: '手动留存', automatic: '五分钟自动留存', agent: '智能体留存', baseline: '初始基线', 'before-restore': '恢复前保护', restored: '恢复结果' })[source]
}
