import type { WritingDay } from '../../../../core/usage/writingStats'

export function summarizeWritingDays(rows: Array<WritingDay & { workspaceId: string }>, workspaceId: string | null): WritingDay[] {
  const filtered = rows.filter((row) => !workspaceId || row.workspaceId === workspaceId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.workspaceId.localeCompare(b.workspaceId))
  const totals = new Map<string, number>()
  const byDate = new Map<string, WritingDay>()
  for (const row of filtered) {
    totals.set(row.workspaceId, row.totalWords)
    const prior = byDate.get(row.date)
    byDate.set(row.date, {
      date: row.date,
      added: (prior?.added ?? 0) + row.added,
      deleted: (prior?.deleted ?? 0) + row.deleted,
      net: (prior?.net ?? 0) + row.net,
      totalWords: [...totals.values()].reduce((sum, value) => sum + value, 0),
      updatedAt: Math.max(prior?.updatedAt ?? 0, row.updatedAt)
    })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
