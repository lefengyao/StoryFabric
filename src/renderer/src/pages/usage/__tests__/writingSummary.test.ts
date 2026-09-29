import { expect, it } from 'vitest'
import { summarizeWritingDays } from '../writingSummary'

it('combines daily edits across projects and carries each project total forward', () => {
  const rows = [
    { workspaceId: 'a', date: '2026-09-01', added: 10, deleted: 2, net: 8, totalWords: 108, updatedAt: 1 },
    { workspaceId: 'b', date: '2026-09-01', added: 5, deleted: 0, net: 5, totalWords: 55, updatedAt: 1 },
    { workspaceId: 'a', date: '2026-09-02', added: 3, deleted: 1, net: 2, totalWords: 110, updatedAt: 2 }
  ]
  expect(summarizeWritingDays(rows, null)).toMatchObject([
    { date: '2026-09-01', added: 15, deleted: 2, net: 13, totalWords: 163 },
    { date: '2026-09-02', added: 3, deleted: 1, net: 2, totalWords: 165 }
  ])
  expect(summarizeWritingDays(rows, 'a')).toMatchObject([
    { date: '2026-09-01', added: 10, deleted: 2, totalWords: 108 },
    { date: '2026-09-02', added: 3, deleted: 1, totalWords: 110 }
  ])
})
