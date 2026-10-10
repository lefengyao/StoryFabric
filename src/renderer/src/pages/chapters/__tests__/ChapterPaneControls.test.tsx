import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChapterPaneToggle } from '../ChaptersPage'

describe('ChapterPaneToggle', () => {
  it('renders an expanded-state collapse control', () => {
    const markup = renderToStaticMarkup(<ChapterPaneToggle collapsed={false} onToggle={vi.fn()} />)

    expect(markup).toContain('data-chapter-pane-collapse="true"')
    expect(markup).toContain('aria-label="收起章节目录"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-controls="chapter-directory-pane"')
  })

  it('renders a collapsed-state rail control', () => {
    const markup = renderToStaticMarkup(<ChapterPaneToggle collapsed onToggle={vi.fn()} />)

    expect(markup).toContain('data-chapter-pane-rail-toggle="true"')
    expect(markup).toContain('aria-label="展开章节目录"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-controls="chapter-directory-pane"')
    expect(markup).toContain('章节')
  })
})
