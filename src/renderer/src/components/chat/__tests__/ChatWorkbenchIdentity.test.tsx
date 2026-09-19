import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatWorkbenchIdentity } from '../ChatWorkbenchIdentity'

describe('ChatWorkbenchIdentity', () => {
  it('只显示身份图标和统计，不重复显示工作台标题', () => {
    const html = renderToStaticMarkup(<ChatWorkbenchIdentity showSessionLength messageCount={2} totalChars={1200} />)
    expect(html).not.toContain('智能体工作台')
    expect(html).toContain('2 条')
  })
})
