import { describe, expect, it } from 'vitest'
import type { SettingMeta } from '../../../shared/types'
import {
  SETTING_LEVEL_GAP,
  SETTING_NODE_HEIGHT,
  SETTING_NODE_WIDTH,
  SETTING_ROW_GAP,
  availableTagParentNames,
  availableParentIds,
  buildSettingsTree,
  settingsTreeItems,
  settingsTreeRootIds
} from './settingsTree'

type TreeItem = SettingMeta & { parentId?: string }

const setting = (id: string, title: string, parentId?: string): TreeItem => ({
  id,
  title,
  category: 'background',
  tags: [],
  parentId
})

describe('settingsTree', () => {
  it('lays out a forest left to right in a stable order regardless of input order', () => {
    const items = [
      setting('root-b', '人物'),
      setting('port', '港口', 'geography'),
      setting('geography', '地理', 'root-a'),
      setting('root-a', '世界观'),
      setting('river', '河流', 'geography')
    ]
    const graph = buildSettingsTree(items)
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))

    expect(byId.get('root-a')?.depth).toBe(0)
    expect(byId.get('geography')?.depth).toBe(1)
    expect(byId.get('port')?.depth).toBe(2)
    expect(byId.get('root-a')?.position.x).toBe(0)
    expect(byId.get('geography')?.position.x).toBe(SETTING_LEVEL_GAP)
    expect(byId.get('port')?.position.x).toBe(SETTING_LEVEL_GAP * 2)
    expect(byId.get('port')!.position.y).toBeLessThan(byId.get('river')!.position.y)
    expect(byId.get('river')!.position.y - byId.get('port')!.position.y).toBe(SETTING_ROW_GAP)
    expect(byId.get('geography')?.position.y).toBe(
      (byId.get('port')!.position.y + byId.get('river')!.position.y) / 2
    )
    expect(graph.edges).toEqual([
      { id: 'setting:root-a:geography', source: 'root-a', target: 'geography' },
      { id: 'setting:geography:port', source: 'geography', target: 'port' },
      { id: 'setting:geography:river', source: 'geography', target: 'river' }
    ])
    expect(buildSettingsTree([...items].reverse())).toEqual(graph)
    expect(graph.width).toBe(SETTING_LEVEL_GAP * 2 + SETTING_NODE_WIDTH)
    expect(graph.height).toBe(Math.max(...graph.nodes.map((node) => node.position.y)) + SETTING_NODE_HEIGHT)
  })

  it('promotes missing parents and breaks each historical cycle with warnings', () => {
    const graph = buildSettingsTree([
      setting('b', '乙', 'a'),
      setting('orphan', '丙', 'missing'),
      setting('a', '甲', 'b')
    ])
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))

    expect(graph.nodes).toHaveLength(3)
    expect(graph.warnings).toEqual([
      expect.objectContaining({ nodeId: 'orphan', kind: 'orphan' }),
      expect.objectContaining({ nodeId: 'a', kind: 'cycle' })
    ])
    expect(byId.get('orphan')?.depth).toBe(0)
    expect(byId.get('a')?.depth).toBe(0)
    expect(byId.get('b')?.depth).toBe(1)
    expect(graph.edges).toEqual([{ id: 'setting:a:b', source: 'a', target: 'b' }])
  })

  it('handles an empty settings list', () => {
    expect(buildSettingsTree([])).toEqual({ nodes: [], edges: [], warnings: [], width: 0, height: 0 })
  })

  it('shows legacy flat tags as children of their setting', () => {
    const root = { ...setting('world', '世界观'), tags: ['地理', '历史'] }
    const graph = buildSettingsTree([root])
    const world = graph.nodes.find((node) => node.id === root.id)!
    const geography = graph.nodes.find((node) => node.title === '地理')!
    const history = graph.nodes.find((node) => node.title === '历史')!

    expect(graph.nodes).toHaveLength(3)
    expect(geography.kind).toBe('tag')
    expect(history.kind).toBe('tag')
    expect(geography.depth).toBe(1)
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: world.id, target: geography.id }),
      expect.objectContaining({ source: world.id, target: history.id })
    ]))
  })

  it('connects explicit child and grandchild tags without losing setting descendants', () => {
    const root = { ...setting('world', '世界观'), tags: ['势力', '哈夫克', '安保部门'], tagParents: { 哈夫克: '势力', 安保部门: '哈夫克' } }
    const graph = buildSettingsTree([root, setting('location', '地理', 'world')])
    const byTitle = new Map(graph.nodes.map((node) => [node.title, node]))

    expect(byTitle.get('势力')?.depth).toBe(1)
    expect(byTitle.get('哈夫克')?.depth).toBe(2)
    expect(byTitle.get('安保部门')?.depth).toBe(3)
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: byTitle.get('势力')?.id, target: byTitle.get('哈夫克')?.id }),
      expect.objectContaining({ source: byTitle.get('哈夫克')?.id, target: byTitle.get('安保部门')?.id }),
      expect.objectContaining({ source: root.id, target: 'location' })
    ]))
  })

  it('excludes the current setting and all descendants from parent choices', () => {
    const items = [
      setting('b', '人物'),
      setting('a', '世界观'),
      setting('child', '地理', 'a'),
      setting('grandchild', '港口', 'child')
    ]

    expect(availableParentIds(items, 'a')).toEqual(['b'])
    expect(availableParentIds([...items].reverse(), 'a')).toEqual(['b'])
    expect(availableParentIds(items, 'new')).toEqual(['child', 'grandchild', 'b', 'a'])
  })

  it('keeps parent choices finite when old files contain a cycle', () => {
    const items = [setting('a', '甲', 'b'), setting('b', '乙', 'a'), setting('c', '丙')]
    expect(availableParentIds(items, 'a')).toEqual(['c'])
  })

  it('selects one root and keeps only that root subtree for the chart', () => {
    const items = [
      setting('root-b', 'Beta'),
      setting('b-child', 'Beta child', 'root-b'),
      setting('root-a', 'Alpha'),
      setting('a-child', 'Alpha child', 'root-a'),
      setting('a-grandchild', 'Alpha grandchild', 'a-child')
    ]

    const selected = settingsTreeItems(items, 'root-a')
    expect(selected.map((item) => item.id)).toEqual(['root-a', 'a-child', 'a-grandchild'])
    expect(selected.find((item) => item.id === 'root-a')?.parentId).toBeUndefined()
    expect(buildSettingsTree(selected).edges).toEqual([
      { id: 'setting:root-a:a-child', source: 'root-a', target: 'a-child' },
      { id: 'setting:a-child:a-grandchild', source: 'a-child', target: 'a-grandchild' }
    ])
  })

  it('uses a selected non-root node as the current root and keeps its descendants', () => {
    const items = [
      setting('root', 'Root'),
      setting('child', 'Child', 'root'),
      setting('grandchild', 'Grandchild', 'child'),
      setting('other', 'Other')
    ]

    const selected = settingsTreeItems(items, 'child')
    expect(selected.map((item) => item.id)).toEqual(['child', 'grandchild'])
    expect(selected.find((item) => item.id === 'child')?.parentId).toBeUndefined()
    expect(selected.find((item) => item.id === 'grandchild')?.parentId).toBe('child')
    expect(buildSettingsTree(selected).nodes.find((node) => node.id === 'child')?.depth).toBe(0)
  })

  it('returns stable root candidates and sorted items regardless of input order', () => {
    const items = [
      setting('root-b', 'Beta'),
      setting('b-child', 'Beta child', 'root-b'),
      setting('root-a', 'Alpha'),
      setting('a-child', 'Alpha child', 'root-a')
    ]

    expect(settingsTreeRootIds(items)).toEqual(['root-a', 'root-b'])
    expect(settingsTreeRootIds([...items].reverse())).toEqual(['root-a', 'root-b'])
    expect(settingsTreeItems(items).map((item) => item.id)).toEqual(
      settingsTreeItems([...items].reverse()).map((item) => item.id)
    )
  })

  it('returns no items for an unknown selected root', () => {
    expect(settingsTreeItems([setting('root', 'Root')], 'missing')).toEqual([])
  })

  it('excludes a tag and its descendants from its parent choices', () => {
    const tags = ['势力', '哈夫克', '安保部门', '地理']
    const parents = { 哈夫克: '势力', 安保部门: '哈夫克' }
    expect(availableTagParentNames(tags, parents, '势力')).toEqual(['地理'])
    expect(availableTagParentNames(tags, parents, '哈夫克')).toEqual(['势力', '地理'])
  })
})
