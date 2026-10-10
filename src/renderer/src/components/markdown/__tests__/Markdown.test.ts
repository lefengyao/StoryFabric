import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Markdown } from '../Markdown'
import { CopyButton } from '../../ui/CopyButton'

vi.mock('../../ui/CopyButton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/CopyButton')>()
  return { ...actual, CopyButton: vi.fn(actual.CopyButton) }
})

describe('Markdown', () => {
  it('opens links in a safe external browsing context', () => {
    const html = renderToStaticMarkup(React.createElement(Markdown, { text: '[外链](https://example.com)' }))
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('adds copy controls for fenced and indented blocks, while keeping inline code inline', () => {
    const html = renderToStaticMarkup(React.createElement(Markdown, { text: '行内 `value`\n\n```text\n  第一行\n\n第二行\n```\n\n    缩进代码' }))
    expect(html.match(/aria-label="复制代码块"/g)).toHaveLength(2)
    expect(html).toContain('  第一行\n\n第二行')
    expect(html).toContain('<code>value</code>')
  })

  it('does not add a block copy button to inline code', () => {
    const html = renderToStaticMarkup(React.createElement(Markdown, { text: '行内 `value`' }))
    expect(html).not.toContain('复制代码块')
  })

  it('copies block contents with their indentation, blank lines and trailing spaces', () => {
    vi.mocked(CopyButton).mockClear()
    const content = '{\n  "标题": "灵力",  \n\n  "说明": "保留空行"\n}\n'
    renderToStaticMarkup(React.createElement(Markdown, { text: `\`\`\`json\n${content}\n\`\`\`\n\n    缩进代码` }))
    expect(vi.mocked(CopyButton).mock.calls.map(([props]) => props.text)).toEqual([content, '缩进代码'])
  })
})
