import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../Markdown'

describe('Markdown links', () => {
  it('opens links in a safe external browsing context', () => {
    const html = renderToStaticMarkup(React.createElement(Markdown, { text: '[外链](https://example.com)' }))
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
