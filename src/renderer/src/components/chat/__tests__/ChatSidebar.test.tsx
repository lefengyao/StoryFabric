import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ChatSidebar } from '../ChatSidebar'

describe('ChatSidebar', () => {
  it('keeps session, model, and context details collapsed by default', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChatSidebar open />
      </MemoryRouter>
    )

    expect(markup).toContain('智能体')
    expect(markup).toContain('aria-label="会话、模型与上下文"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('创作会话')
    expect(markup).not.toContain('选择模型')
  })
})
