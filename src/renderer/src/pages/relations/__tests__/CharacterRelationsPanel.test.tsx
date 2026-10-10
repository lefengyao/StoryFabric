import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CharacterDoc, Relationship } from '../../../../../shared/types'
import { CharacterRelationsPanel } from '../CharacterRelationsPanel'
import { relationshipsForCharacter } from '../relationshipInspector'

function character(id: string, name: string): CharacterDoc {
  return { id, name, aliases: [], role: '', faction: '', gender: '', age: '', tags: [], summary: '', content: '' }
}

function relationship(id: string, fromId: string, toId: string, directed: boolean): Relationship {
  return { id, fromId, toId, directed, type: '朋友', label: '幼年相识', description: '曾一起远行\n后来重逢' }
}

const selected = character('a', '林舟')
const counterpart = character('b', '陈星')
const callbacks = { onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() }

function renderPanel(relationships: Relationship[], options: { canAdd?: boolean; busy?: boolean; error?: string | null } = {}) {
  return renderToStaticMarkup(
    <CharacterRelationsPanel
      character={selected}
      items={relationshipsForCharacter(selected, [selected, counterpart], relationships)}
      canAdd={options.canAdd ?? true}
      busy={options.busy ?? false}
      error={options.error ?? null}
      {...callbacks}
    />
  )
}

describe('CharacterRelationsPanel', () => {
  it('shows outgoing, incoming, and mutual endpoints along with their relation details', () => {
    const html = renderPanel([
      relationship('outgoing', 'a', 'b', true),
      relationship('incoming', 'b', 'a', true),
      relationship('mutual', 'b', 'a', false)
    ])
    const text = html.replace(/<[^>]+>/g, '')
    expect(html).toContain('aria-label="林舟指向陈星"')
    expect(html).toContain('aria-label="陈星指向林舟"')
    expect(html).toContain('aria-label="林舟与陈星的双向关系"')
    expect(text).toContain('林舟→陈星')
    expect(text).toContain('陈星→林舟')
    expect(text).toContain('林舟⇄陈星')
    expect(text).toContain('与其他人物的关系 · 3 条')
    expect(text).toContain('朋友幼年相识')
    expect(text).toContain('曾一起远行\n后来重逢')
    expect(html).toContain('aria-label="编辑与陈星的关系"')
    expect(html).toContain('aria-label="删除与陈星的关系"')
  })

  it('renders Unicode names and descriptions as safe text and keeps long names readable', () => {
    const person = character('a', '长名字🙂<舟> & "林"')
    const other = character('b', '𠮷星')
    const relation = { ...relationship('unicode', 'a', 'b', true), type: '', label: '<旧友>', description: '<script>alert("x")</script>\n归来 & 重逢' }
    const html = renderToStaticMarkup(
      <CharacterRelationsPanel character={person} items={relationshipsForCharacter(person, [person, other], [relation])} canAdd busy={false} error={null} {...callbacks} />
    )
    expect(html).toContain('<h2 class="break-words text-base font-semibold">长名字🙂&lt;舟&gt; &amp; &quot;林&quot;</h2>')
    expect(html).toContain('𠮷星')
    expect(html).toContain('未分类')
    expect(html).toContain('&lt;旧友&gt;')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;\n归来 &amp; 重逢')
    expect(html).not.toContain('<script>')
    expect(html).toContain('aria-label="编辑与𠮷星的关系"')
  })

  it('offers a clear empty state and disables adding when no second character exists', () => {
    const html = renderPanel([], { canAdd: false })
    const addButton = html.match(/<button[^>]+aria-label="为林舟添加关系"[^>]*>/)?.[0]
    expect(html).toContain('与其他人物的关系 · 0 条')
    expect(html).toContain('这个人物还没有关系')
    expect(html).toContain('至少需要两位人物')
    expect(html).toContain('上方按钮添加关系')
    expect(html).not.toContain('拖动连接')
    expect(addButton).toContain('disabled=""')
    expect(html).not.toContain('aria-label="编辑与')
  })

  it('disables every action while a save or deletion is in progress', () => {
    const html = renderPanel([relationship('busy', 'a', 'b', true)], { busy: true })
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(4)
    for (const button of buttons) expect(button).toContain('disabled=""')
  })

  it('keeps errors visible and allows normal actions when idle', () => {
    const html = renderPanel([relationship('error', 'a', 'b', true)], { error: '保存失败：磁盘不可写' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('保存失败：磁盘不可写')
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(4)
    for (const button of buttons) expect(button).not.toContain('disabled=""')
  })
})
