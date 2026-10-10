import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MemoryPage } from '../MemoryPage'
import { PlatformAccountConfig, UserPage } from '../../user/UserPage'

describe('用户与记忆页面', () => {
  it('在账户服务不可用时仍显示用户入口，而不是空白占位页', () => {
    const userMarkup = renderToStaticMarkup(<MemoryRouter><UserPage /></MemoryRouter>)
    const memoryMarkup = renderToStaticMarkup(<MemoryRouter><MemoryPage /></MemoryRouter>)

    expect(userMarkup).toContain('>用户</h1>')
    expect(userMarkup).toContain('登录 / 注册')
    expect(userMarkup).toContain('Trailblazer 账户服务')
    expect(userMarkup).toContain('href="/memory"')
    expect(userMarkup).not.toContain('全局记忆</h2>')
    expect(userMarkup).not.toContain('当前项目记忆')
    expect(memoryMarkup).toContain('>记忆</h1>')
    expect(memoryMarkup).toContain('全局记忆</h2>')
    expect(memoryMarkup).toContain('当前项目记忆')
    expect(memoryMarkup.indexOf('全局记忆</h2>')).toBeLessThan(memoryMarkup.indexOf('当前项目记忆</h2>'))
  })

  it('账户入口说明登录授权正在进行时的状态', () => {
    const userMarkup = renderToStaticMarkup(<MemoryRouter><UserPage /></MemoryRouter>)

    expect(userMarkup).toContain('登录你的 Trailblazer 账号')
    expect(userMarkup).toContain('StoryFabric 不显示 API Key')
  })

  it('仅在桌面账户桥接提供配置方法时显示 Platform 地址设置', () => {
    const unsupported = renderToStaticMarkup(<PlatformAccountConfig account={{} as never} />)
    const supported = renderToStaticMarkup(<PlatformAccountConfig account={{
      getConfig: async () => ({ platformWebUrl: 'https://accounts.example.com', source: 'application' }),
      setPlatformWebUrl: async () => ({ platformWebUrl: 'https://accounts.example.com', source: 'application' })
    } as never} />)

    expect(unsupported).toBe('')
    expect(supported).toContain('账户服务地址')
    expect(supported).toContain('Platform 前端网址')
    expect(supported).toContain('清除应用地址')
  })
})
