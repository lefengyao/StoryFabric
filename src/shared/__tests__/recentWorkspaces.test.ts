import { describe, expect, it } from 'vitest'
import { forgetRecentWorkspace, markRecentWorkspace, orderRecentWorkspacePaths } from '../recentWorkspaces'

describe('recent workspace records', () => {
  it('forgets one path and its timestamp without touching other entries', () => {
    const state = { recentWorkspaces: ['first', 'second'], recentWorkspaceOpenedAt: { first: '2026-09-01T00:00:00.000Z', second: '2026-09-02T00:00:00.000Z' } }
    expect(forgetRecentWorkspace(state, 'first')).toEqual({ recentWorkspaces: ['second'], recentWorkspaceOpenedAt: { second: '2026-09-02T00:00:00.000Z' } })
    expect(state.recentWorkspaces).toEqual(['first', 'second'])
  })
  it('deduplicates and moves a successfully opened path to the front', () => {
    const next = markRecentWorkspace(
      {
        recentWorkspaces: ['old', 'new'],
        recentWorkspaceOpenedAt: { old: '2026-09-01T00:00:00.000Z' }
      },
      'new',
      '2026-09-11T08:00:00.000Z'
    )

    expect(next.recentWorkspaces).toEqual(['new', 'old'])
    expect(next.recentWorkspaceOpenedAt).toEqual({
      new: '2026-09-11T08:00:00.000Z',
      old: '2026-09-01T00:00:00.000Z'
    })
  })

  it('works with legacy settings that have no timestamp map', () => {
    expect(markRecentWorkspace({ recentWorkspaces: ['old'] }, 'new', '2026-09-11T08:00:00.000Z')).toEqual({
      recentWorkspaces: ['new', 'old'],
      recentWorkspaceOpenedAt: { new: '2026-09-11T08:00:00.000Z' }
    })
  })

  it('orders timestamped paths newest first and preserves legacy array order when timestamps are absent', () => {
    const paths = ['legacy-a', 'newer', 'older']

    expect(
      orderRecentWorkspacePaths(
        paths,
        {
          newer: '2026-09-10T00:00:00.000Z',
          older: '2026-09-01T00:00:00.000Z'
        }
      )
    ).toEqual(['newer', 'older', 'legacy-a'])
    expect(paths).toEqual(['legacy-a', 'newer', 'older'])
  })

  it('keeps only eight persisted records and never mutates the input state', () => {
    const paths = Array.from({ length: 8 }, (_, index) => `path-${index}`)
    const openedAt = {
      'path-0': '2026-09-01T00:00:00.000Z',
      'path-7': '2026-09-08T00:00:00.000Z'
    }
    const state = { recentWorkspaces: paths, recentWorkspaceOpenedAt: openedAt }

    const next = markRecentWorkspace(state, 'path-8', '2026-09-11T08:00:00.000Z')

    expect(next.recentWorkspaces).toHaveLength(8)
    expect(next.recentWorkspaces[0]).toBe('path-8')
    expect(next.recentWorkspaceOpenedAt).toEqual({
      'path-8': '2026-09-11T08:00:00.000Z',
      'path-0': '2026-09-01T00:00:00.000Z'
    })
    expect(state.recentWorkspaces).toEqual(paths)
    expect(state.recentWorkspaceOpenedAt).toEqual(openedAt)
  })

  it('removes duplicate legacy paths while retaining the first occurrence order', () => {
    expect(
      markRecentWorkspace(
        { recentWorkspaces: ['old', 'old', 'older'], recentWorkspaceOpenedAt: {} },
        'new',
        '2026-09-11T08:00:00.000Z'
      ).recentWorkspaces
    ).toEqual(['new', 'old', 'older'])
  })

  it('does not treat non-ISO timestamps as dated records', () => {
    expect(
      orderRecentWorkspacePaths(
        ['dated', 'legacy'],
        { dated: '2026-09-01T00:00:00.000Z', legacy: 'September 9, 2026' }
      )
    ).toEqual(['dated', 'legacy'])

    expect(
      orderRecentWorkspacePaths(
        ['legacy', 'invalid-date', 'valid-date'],
        {
          'invalid-date': '2026-02-30T00:00:00.000Z',
          'valid-date': '2026-02-01T00:00:00.000Z'
        }
      )
    ).toEqual(['valid-date', 'legacy', 'invalid-date'])
  })
})
