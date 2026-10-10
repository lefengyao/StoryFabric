import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import * as implementation from '../GraphImages'
import { selectEventGraph, selectRelationshipGraph } from '../selection'
import type { CharacterDoc, StoryEvent } from '../../../../../shared/types'
const components = implementation as unknown as Record<string, ComponentType<any>>
const character = (id: string): CharacterDoc => ({ id, name: id, aliases: [], role: '', faction: '学院', gender: '', age: '', tags: [], summary: '', content: '' })
const event = (id: string, order: number, prevIds: string[], nextIds: string[]): StoryEvent => ({ id, title: id, order, volumeId: 'v', prevIds, nextIds, storyTime: '春夜', location: '', characterIds: [], tags: [], content: '' })

it('draws selected relationship graph including independent nodes and directional labels', () => {
  expect(components.RelationshipGraphImage).toBeTypeOf('function')
  const graph = selectRelationshipGraph(['林晚', '老师', '孤立角色', '隐藏人物'].map(character), [{ id: 'r', fromId: '林晚', toId: '老师', type: '师徒', label: '旧日恩师', description: '', directed: true }], new Set(['林晚', '老师', '孤立角色']), new Set(['r']))
  const html = renderToStaticMarkup(createElement(components.RelationshipGraphImage, { graph, workspaceName: '远星' }))
  for (const text of ['林晚', '老师', '孤立角色', '学院', '旧日恩师', 'marker-end']) expect(html).toContain(text)
  expect(html).not.toContain('隐藏人物')
  expect(html).not.toContain('react-flow__controls')
  const positions = [...html.matchAll(/data-export-node="[^"]+" style="([^"]+)"/g)].map((match) => match[1])
  expect(positions).toHaveLength(3)
  expect(positions.every((style) => /left:[\d.]+px/.test(style) && /top:[\d.]+px/.test(style))).toBe(true)
  expect(new Set(positions).size).toBe(3)
})

it('draws boundary notices without exporting an omitted event title or an invented edge', () => {
  expect(components.EventGraphImage).toBeTypeOf('function')
  const graph = selectEventGraph([event('开端', 1, [], ['秘密中间事件']), event('秘密中间事件', 2, ['开端'], ['结局']), event('结局', 3, ['秘密中间事件'], [])], new Set(['v']), new Set(['开端', '结局']))
  const html = renderToStaticMarkup(createElement(components.EventGraphImage, { graph, volumes: [{ id: 'v', title: '第一卷', order: 1 }], workspaceName: '远星' }))
  for (const text of ['开端', '结局', '第一卷', '春夜', '连接范围外事件']) expect(html).toContain(text)
  expect(html).not.toContain('秘密中间事件')
  expect(html).not.toContain('data-export-edge=')
  expect(html.match(/data-export-node=/g)).toHaveLength(2)
})
