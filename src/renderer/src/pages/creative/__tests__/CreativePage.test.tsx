import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CreativePage } from '../CreativePage'

describe('CreativePage', () => {
  it('separates creative resources into a dedicated scrollable workspace', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><CreativePage /></MemoryRouter>)

    expect(markup).toContain('data-scroll-region="creative-page-content"')
    expect(markup).toContain('Skill 与插件')
    expect(markup).toContain('自定义规则集')
    expect(markup).toContain('.storyfabric.plugin.zip')
  })
})
