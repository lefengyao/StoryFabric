import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceListItem } from '../../../../../shared/types'
import { RecentWorkspaceList, triggerRecentWorkspaceOpen, triggerRecentWorkspaceRetry } from '../RecentWorkspaceList'
import { createRecentConfigKey, createWorkspaceOpenRequestGuard, isWorkspaceRequestCurrent, openRecentWorkspaceThenRefresh, shouldAutoLoadRecentWorkspaces, shouldClearRecentWorkspaceOpening, shouldClearWorkspaceLoading, shouldCloseWorkspacePicker, shouldResetRecentWorkspaces } from '../WelcomePage'

const item = (index: number, overrides: Partial<WorkspaceListItem> = {}): WorkspaceListItem => ({
  name: `工作区 ${index}`,
  path: `/workspace/${index}`,
  chapterCount: index,
  volumeCount: 1,
  relationshipCount: 2,
  ...overrides
})

const renderList = (props: Partial<React.ComponentProps<typeof RecentWorkspaceList>> = {}): string =>
  renderToStaticMarkup(
    <RecentWorkspaceList
      items={[item(1)]}
      loading={false}
      error={null}
      openingPath={null}
      onOpen={vi.fn()}
      onRename={vi.fn()}
      onForget={vi.fn()}
      onRetry={vi.fn()}
      {...props}
    />
  )

const renderedButtons = (markup: string): string[] =>
  Array.from(markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g), (match) => match[0])

describe('RecentWorkspaceList', () => {
  it('does not log in for each service-key keystroke, but loads immediately after connecting', async () => {
    const loginRemote = vi.fn()
    let submitted = false

    for (const _key of ['s', 'se', 'sec', 'secr', 'secret']) {
      if (shouldAutoLoadRecentWorkspaces(false, 'remote', submitted)) loginRemote()
    }
    expect(loginRemote).not.toHaveBeenCalled()

    submitted = true
    if (shouldAutoLoadRecentWorkspaces(false, 'remote', submitted)) loginRemote()
    expect(loginRemote).toHaveBeenCalledOnce()
  })

  it('shows an empty state when there are no recent workspaces', () => {
    const markup = renderList({ items: [] })

    expect(markup).toContain('还没有最近工作区')
  })

  it('offers rename and safe removal next to each recent project', () => {
    const markup = renderList()
    expect(markup).toContain('重命名项目')
    expect(markup).toContain('从最近列表移除')
    expect(markup).toContain('不会删除项目文件')
  })

  it('shows loading state while recent workspaces are loading', () => {
    const markup = renderList({ loading: true, items: [] })

    expect(markup).toContain('正在加载最近工作区')
  })

  it('shows an error and a retry button inside the recent area', () => {
    const markup = renderList({ error: '服务暂时不可用' })

    expect(markup).toContain('服务暂时不可用')
    expect(markup).toContain('重试')
  })

  it('triggers a recent-list refresh after opening succeeds', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)

    await openRecentWorkspaceThenRefresh('/workspace/1', open, refresh)

    expect(open).toHaveBeenCalledWith('/workspace/1')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('swallows a rejected non-blocking refresh', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn().mockRejectedValue(new Error('stale refresh'))

    await expect(openRecentWorkspaceThenRefresh('/workspace/1', open, refresh)).resolves.toBeUndefined()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not start another row while a workspace is opening', () => {
    const onOpen = vi.fn()

    triggerRecentWorkspaceOpen('/workspace/1', null, onOpen)
    triggerRecentWorkspaceOpen('/workspace/2', '/workspace/1', onOpen)

    expect(onOpen).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith('/workspace/1')
  })

  it('models the retry button event through the retry callback', () => {
    const onRetry = vi.fn()

    triggerRecentWorkspaceRetry(onRetry)

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('creates a stable key for the complete recent-list configuration', () => {
    const key = createRecentConfigKey(false, false, 'remote', 'https://example.test', 'secret')

    expect(key).toBe(createRecentConfigKey(false, false, 'remote', 'https://example.test', 'secret'))
    expect(key).not.toBe(createRecentConfigKey(false, false, 'local', '', ''))
    expect(key).not.toBe(createRecentConfigKey(false, false, 'remote', 'https://example.test', 'other-secret'))
  })

  it('does not cancel the initial recent-workspace load before its result arrives', () => {
    expect(shouldResetRecentWorkspaces(null, 'local-config')).toBe(false)
    expect(shouldResetRecentWorkspaces('local-config', 'local-config')).toBe(false)
    expect(shouldResetRecentWorkspaces('old-config', 'new-config')).toBe(true)
  })

  it('shows recent opened times in the user local timezone', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')

    const markup = renderList({ items: [item(1, { lastOpenedAt: '2026-09-11T08:00:00.000Z' })] })

    expect(markup).toContain('最近打开：2026/09/11 16:00')
    vi.unstubAllEnvs()
  })

  it('shows at most five items with names, readable times and explicit open buttons', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    const markup = renderList({
      items: Array.from({ length: 6 }, (_, index) => item(index + 1, {
        name: index === 0 ? '这是一个很长的项目名称用于验证截断' : `项目 ${index + 1}`,
        lastOpenedAt: index === 0 ? '2026-09-11T08:00:00.000Z' : undefined
      }))
    })

    expect(markup).toContain('这是一个很长的项目名称用于验证截断')
    expect(markup).toContain('最近打开：2026/09/11 16:00')
    expect(markup).toContain('暂无最近打开时间')
    expect((markup.match(/>打开</g) ?? []).length).toBe(5)
    expect(markup).not.toContain('项目 6')
    vi.unstubAllEnvs()
  })

  it('disables every row while one workspace is opening, but only shows loading on that row', () => {
    const markup = renderList({ items: [item(1), item(2)], openingPath: '/workspace/1' })
    const buttons = renderedButtons(markup).filter((button) => button.includes('>打开</span>'))

    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toContain('disabled=""')
    expect(buttons[0]).toContain('animate-spin')
    expect(buttons[1]).toContain('disabled=""')
    expect(buttons[1]).not.toContain('animate-spin')
  })

  it('keeps open, rename, and remove as sibling buttons without nested controls', () => {
    const markup = renderList({ items: [item(1), item(2)] })

    expect(markup).not.toContain('role="button"')
    expect(markup).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/)
    expect(renderedButtons(markup)).toHaveLength(6)
  })

  it('accepts only the current modal request configuration and generation', () => {
    expect(isWorkspaceRequestCurrent('config-a', 'config-a', 3, 3)).toBe(true)
    expect(isWorkspaceRequestCurrent('config-a', 'config-b', 3, 3)).toBe(false)
    expect(isWorkspaceRequestCurrent('config-a', 'config-a', 3, 4)).toBe(false)
  })

  it('clears modal loading only for the mounted current request', () => {
    expect(shouldClearWorkspaceLoading(true, 'config-a', 'config-a', 3, 3)).toBe(true)
    expect(shouldClearWorkspaceLoading(true, 'config-a', 'config-a', 3, 4)).toBe(false)
    expect(shouldClearWorkspaceLoading(true, 'config-a', 'config-b', 3, 3)).toBe(false)
    expect(shouldClearWorkspaceLoading(false, 'config-a', 'config-a', 3, 3)).toBe(false)
  })

  it('allows closing the workspace picker while loading or an action is busy', () => {
    expect(shouldCloseWorkspacePicker(false, true, false)).toBe(true)
    expect(shouldCloseWorkspacePicker(false, false, true)).toBe(true)
    expect(shouldCloseWorkspacePicker(false, true, true)).toBe(true)
    expect(shouldCloseWorkspacePicker(true, true, true)).toBe(false)
  })

  it('invalidates picker requests after close or unmount so stale errors cannot write back', () => {
    let mounted = true
    let generation = 7
    const guard = createWorkspaceOpenRequestGuard(
      'config-a',
      generation,
      () => mounted,
      () => 'config-a',
      () => generation
    )

    expect(guard.isCurrent()).toBe(true)
    generation += 1
    expect(guard.isCurrent()).toBe(false)

    generation = 7
    mounted = false
    expect(guard.isCurrent()).toBe(false)
  })

  it('clears recent opening only for the mounted current request', () => {
    expect(shouldClearRecentWorkspaceOpening(true, 3, 3)).toBe(true)
    expect(shouldClearRecentWorkspaceOpening(true, 3, 4)).toBe(false)
    expect(shouldClearRecentWorkspaceOpening(false, 3, 3)).toBe(false)
  })

  it('discards a stale open result before refreshing recent workspaces', async () => {
    let currentConfigKey = 'config-a'
    let currentRequestId = 1
    let resolveOpen: (() => void) | undefined
    const guard = createWorkspaceOpenRequestGuard(
      'config-a',
      1,
      () => true,
      () => currentConfigKey,
      () => currentRequestId
    )
    const refresh = vi.fn()
    const opening = openRecentWorkspaceThenRefresh(
      '/workspace/1',
      () => new Promise<void>((resolve) => { resolveOpen = resolve }),
      refresh,
      guard.isCurrent
    )

    currentConfigKey = 'config-b'
    currentRequestId = 2
    resolveOpen?.()
    await opening

    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not invoke the opener when the recent item was loaded for an old config', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn()
    const guard = createWorkspaceOpenRequestGuard(
      'old-config',
      1,
      () => true,
      () => 'new-config',
      () => 1
    )

    await openRecentWorkspaceThenRefresh('/workspace/1', open, refresh, guard.isCurrent)

    expect(open).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
