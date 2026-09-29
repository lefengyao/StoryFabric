import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MemoryPage } from '../MemoryPage'
import { UserPage } from '../../user/UserPage'

describe('用户与记忆页面', () => {
  it('把跨项目用户偏好和当前项目记忆分到不同页面', () => {
    const userMarkup = renderToStaticMarkup(<MemoryRouter><UserPage /></MemoryRouter>)
    const memoryMarkup = renderToStaticMarkup(<MemoryRouter><MemoryPage /></MemoryRouter>)

    expect(userMarkup).toContain('>用户</h1>')
    expect(userMarkup).toContain('用户偏好')
    expect(userMarkup).not.toContain('当前项目记忆')
    expect(memoryMarkup).toContain('>记忆</h1>')
    expect(memoryMarkup).toContain('当前项目记忆')
    expect(memoryMarkup).not.toContain('用户偏好')
  })
})
