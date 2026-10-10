import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { buildSettingsTree } from '../../../lib/settingsTree'
import { SettingsChildNodeForm, SettingsNodeDialog } from '../SettingsNodeDialog'

// The real modal renders into a client-only portal.
vi.mock('../../../components/ui/modal', () => ({
  Modal: ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => <section><h1>{title}</h1><p>{description}</p>{children}</section>
}))

describe('setting node dialog', () => {
  it('keeps the node content visible with an accessible operation button', () => {
    const node = buildSettingsTree([{ id: 'root', title: '力量', summary: '三段结构', category: 'background', tags: [] }]).nodes[0]
    const html = renderToStaticMarkup(<SettingsNodeDialog node={node} content="**详细规则**" loading={false} onClose={() => {}} onAddChild={async () => {}} onDelete={async () => {}} />)
    expect(html).toContain('力量')
    expect(html).toContain('三段结构')
    expect(html).toContain('<strong>详细规则</strong>')
    expect(html).toContain('aria-label="节点操作"')
    expect(html).toContain('操作')
  })

  it('offers all three child fields and shows the explicit parent', () => {
    const html = renderToStaticMarkup(<SettingsChildNodeForm parentTitle="灵力" value={{ title: '用途', summary: '运转世界', content: '详细规则\n\n第二段' }} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} busy={false} />)
    expect(html).toContain('灵力')
    expect(html).toContain('aria-label="子节点标题"')
    expect(html).toContain('aria-label="子节点简述"')
    expect(html).toContain('aria-label="子节点详细内容"')
    expect(html).toContain('详细规则\n\n第二段')
    expect(html).toContain('保存子节点')
  })
})
