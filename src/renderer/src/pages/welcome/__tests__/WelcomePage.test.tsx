import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WelcomePage } from '../WelcomePage'
import { version } from '../../../../../../package.json'
import { WorkspaceUpgradeDialogContent } from '../../../components/layout/WorkspaceUpgradeDialog'
import { openRecentWorkspaceThenRefresh } from '../WelcomePage'

describe('WelcomePage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows local workspace actions without a remote service connection on desktop', () => {
    vi.stubGlobal('window', { api: {} })

    const markup = renderToStaticMarkup(<WelcomePage />)

    expect(markup).toContain('打开其他工作区')
    expect(markup).toContain('创建新工作区')
    expect(markup).toContain(`v${version}`)
    expect(markup).not.toContain('连接服务')
    expect(markup).not.toContain('服务地址')
    expect(markup).not.toContain('访问密钥')
    expect(markup).not.toContain('>服务</button>')
  })
  it('explains the backup, new format, and safe cancellation with the selected project visible', () => {
    const markup = renderToStaticMarkup(<WorkspaceUpgradeDialogContent path="E:/novels/旧项目" onAnswer={vi.fn()} />)
    expect(markup).toContain('格式 4')
    expect(markup).toContain('格式 5')
    expect(markup).toContain('.storyfabric/format-backups')
    expect(markup).toContain('E:/novels/旧项目')
    expect(markup).toContain('取消会保留原项目和当前工作区')
    expect(markup).toContain('备份并升级')
  })
  it('does not refresh recents when opening was cancelled at the upgrade prompt', async () => {
    const open = vi.fn(async () => false)
    const refresh = vi.fn()
    await openRecentWorkspaceThenRefresh('/legacy', open, refresh)
    expect(open).toHaveBeenCalledExactlyOnceWith('/legacy')
    expect(refresh).not.toHaveBeenCalled()
  })
})
