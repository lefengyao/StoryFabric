import { expect, it } from 'vitest'
import { CommitCoordinator, type ChangeSet } from '../commitCoordinator'

const changeSet: ChangeSet = {
  id: 'cs-1', workspaceId: 'w', runId: 'r', changes: [
    { id: 'setting', path: 'settings/a.md', before: '旧设定', after: '新设定', baseRevision: 1 },
    { id: 'chapter', path: 'chapters/a.md', before: '旧正文', after: '依赖新设定的正文', baseRevision: 1, dependsOn: ['setting'] }
  ]
}

it('requires dependency closure, detects revision conflicts and makes confirmation idempotent', async () => {
  const coordinator = new CommitCoordinator({ 'settings/a.md': { text: '旧设定', revision: 1 }, 'chapters/a.md': { text: '旧正文', revision: 1 } })
  await expect(coordinator.confirm({ ...changeSet, id: 'cs-missing', changes: [changeSet.changes[1]] })).resolves.toMatchObject({ status: 'rejected' })
  await expect(coordinator.confirm(changeSet, { selectedIds: ['setting', 'chapter'] })).resolves.toMatchObject({ status: 'applied' })
  await expect(coordinator.confirm(changeSet, { selectedIds: ['setting', 'chapter'] })).resolves.toMatchObject({ status: 'applied' })
  expect(coordinator.get('chapters/a.md')?.text).toBe('依赖新设定的正文')
  expect(coordinator.get('chapters/a.md')?.revision).toBe(2)
})

it('does not overwrite a document edited after the candidate was generated', async () => {
  const coordinator = new CommitCoordinator({ 'chapters/a.md': { text: '旧正文', revision: 1 } })
  coordinator.edit('chapters/a.md', '用户新稿')
  await expect(coordinator.confirm({ id: 'cs-2', workspaceId: 'w', runId: 'r', changes: [{ id: 'chapter', path: 'chapters/a.md', before: '旧正文', after: '候选', baseRevision: 1 }] })).resolves.toMatchObject({ status: 'conflict' })
  expect(coordinator.get('chapters/a.md')?.text).toBe('用户新稿')
})
