import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as implementation from '../ReadingImage'
import type { CharacterDoc, OutlineDoc } from '../../../../../shared/types'
const components = implementation as unknown as Record<string, ComponentType<any>>

describe('unified document reading images', () => {
  it('includes the full character metadata and long Markdown down to the final paragraph', () => {
    expect(components.ReadingImage).toBeTypeOf('function')
    const character: CharacterDoc = { id: 'c', name: '林晚', tier: 'primary', aliases: ['晚晚'], role: '星图修复师', faction: '星环学院', gender: '女', age: '十九岁', tags: ['法师'], summary: '流落异乡', content: `${'很长的设定段落。\n\n'.repeat(600)}\n\n| 线索 | 地点 |\n|---|---|\n| 最后秘密 | 月港 |\n\n完整末段。` }
    const html = renderToStaticMarkup(createElement(components.ReadingImage, { kind: 'character', document: character, workspaceName: '远星' }))
    for (const text of ['远星', '林晚', '主要角色', '晚晚', '星图修复师', '星环学院', '十九岁', '法师', '流落异乡', '最后秘密', '完整末段。']) expect(html).toContain(text)
    expect(html).toContain('<table>')
    expect(html).not.toContain('line-clamp')
  })
  it('exports only the supplied standalone outline and hides an absent chapter association', () => {
    expect(components.ReadingImage).toBeTypeOf('function')
    const outline: OutlineDoc = { id: 'o', title: '独立章纲', kind: 'chapter', order: 1, content: '终章构想\n\n- 归航\n- 最后一行' }
    const html = renderToStaticMarkup(createElement(components.ReadingImage, { kind: 'outline', document: outline, workspaceName: '远星' }))
    expect(html).toContain('独立章纲')
    expect(html).toContain('章纲')
    expect(html).toContain('最后一行')
    expect(html).not.toContain('关联章节')
    expect(html).not.toContain('undefined')
  })
})
