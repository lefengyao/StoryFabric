import { expect, it } from 'vitest'
import type { UsageRecord, WorkspaceListItem } from '../../../../../shared/types'
import { usageProjectOptions } from '../usageProjects'

const record = (workspaceId?: string): UsageRecord => ({
  at: 1, workspaceId, providerId: 'p', providerName: 'P', model: 'm',
  promptTokens: 1, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0
})

it('lists known and historical projects without merging projects that share a name', () => {
  const known = [
    { name: '同名项目', path: 'C:/books/first' },
    { name: '同名项目', path: 'C:/books/second' },
    { name: '空项目', path: 'C:/books/empty' }
  ] as WorkspaceListItem[]
  const options = usageProjectOptions([record('C:/books/first'), record('C:/old/removed'), record()], known, { name: '当前项目', path: 'C:/current' })

  expect(options.map((option) => option.id)).toEqual(expect.arrayContaining([
    'C:/books/first', 'C:/books/second', 'C:/books/empty', 'C:/old/removed', 'C:/current'
  ]))
  expect(options.filter((option) => option.name === '同名项目')).toHaveLength(2)
  expect(options.find((option) => option.id === 'C:/old/removed')?.name).toBe('removed')
  expect(options.some((option) => !option.id)).toBe(false)
})
