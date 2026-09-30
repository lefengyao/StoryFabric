import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MemoryPage } from '../MemoryPage'
import { UserPage } from '../../user/UserPage'

describe('用户与记忆页面', () => {
  it('在记忆页管理全局和当前项目记忆，用户页引导到记忆页', () => {
    const userMarkup = renderToStaticMarkup(<MemoryRouter><UserPage /></MemoryRouter>)
    const memoryMarkup = renderToStaticMarkup(<MemoryRouter><MemoryPage /></MemoryRouter>)

    expect(userMarkup).toContain('>用户</h1>')
    expect(userMarkup).toContain('用户功能正在开发中')
    expect(userMarkup).toContain('href="/memory"')
    expect(userMarkup).not.toContain('全局记忆</h2>')
    expect(userMarkup).not.toContain('当前项目记忆')
    expect(memoryMarkup).toContain('>记忆</h1>')
    expect(memoryMarkup).toContain('全局记忆</h2>')
    expect(memoryMarkup).toContain('当前项目记忆')
    expect(memoryMarkup.indexOf('全局记忆</h2>')).toBeLessThan(memoryMarkup.indexOf('当前项目记忆</h2>'))
  })
})
