import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WelcomePage } from '../WelcomePage'

describe('WelcomePage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows local workspace actions without a remote service connection on desktop', () => {
    vi.stubGlobal('window', { api: {} })

    const markup = renderToStaticMarkup(<WelcomePage />)

    expect(markup).toContain('打开其他工作区')
    expect(markup).toContain('创建新工作区')
    expect(markup).not.toContain('连接服务')
    expect(markup).not.toContain('服务地址')
    expect(markup).not.toContain('访问密钥')
    expect(markup).not.toContain('>服务</button>')
  })
})
