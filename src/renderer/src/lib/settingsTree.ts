import type { SettingMeta } from '../../../shared/types'

export const SETTING_NODE_WIDTH = 224
export const SETTING_NODE_HEIGHT = 92
export const SETTING_LEVEL_GAP = 292
export const SETTING_ROW_GAP = 132

export type SettingsTreeItem = SettingMeta & { parentId?: string }

type LayoutItem = SettingsTreeItem & { kind?: 'tag' }

export interface SettingsTreeNode {
  id: string
  title: string
  category: SettingMeta['category']
  tags: string[]
  kind?: 'tag'
  parentId?: string
  depth: number
  position: { x: number; y: number }
}

export interface SettingsTreeEdge {
  id: string
  source: string
  target: string
}

export interface SettingsTreeWarning {
  nodeId: string
  kind: 'orphan' | 'cycle'
  message: string
}

export interface SettingsTreeGraph {
  nodes: SettingsTreeNode[]
  edges: SettingsTreeEdge[]
  warnings: SettingsTreeWarning[]
  width: number
  height: number
}

function compareSettings(a: SettingsTreeItem, b: SettingsTreeItem): number {
  return a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id, 'zh-CN')
}

function normalizedParentId(item: SettingsTreeItem): string | undefined {
  const parentId = item.parentId?.trim()
  return parentId || undefined
}

function sortedSettings(input: readonly SettingsTreeItem[]): SettingsTreeItem[] {
  return [...input].sort(compareSettings)
}

function tagNodeId(settingId: string, tag: string): string {
  return `tag:${encodeURIComponent(settingId)}:${encodeURIComponent(tag)}`
}

function expandedTags(input: readonly SettingsTreeItem[]): { items: LayoutItem[]; warnings: SettingsTreeWarning[] } {
  const items: LayoutItem[] = []
  const warnings: SettingsTreeWarning[] = []
  for (const setting of input) {
    items.push(setting)
    const tags = [...new Set(setting.tags.filter((tag) => typeof tag === 'string' && tag.trim()))]
    const known = new Set(tags)
    const tagParents = setting.tagParents && typeof setting.tagParents === 'object' && !Array.isArray(setting.tagParents)
      ? setting.tagParents : {}
    for (const tag of tags) {
      const parent = Object.hasOwn(tagParents, tag) ? tagParents[tag] : undefined
      let valid = typeof parent === 'string' && parent.length > 0
      let kind: SettingsTreeWarning['kind'] = 'orphan'
      if (valid) {
        const seen = new Set([tag])
        let current: string | undefined = parent
        while (current) {
          if (!known.has(current)) { valid = false; break }
          if (seen.has(current)) { valid = false; kind = 'cycle'; break }
          seen.add(current)
          current = Object.hasOwn(tagParents, current) ? tagParents[current] : undefined
        }
      }
      if (parent && !valid) warnings.push({ nodeId: tagNodeId(setting.id, tag), kind, message: kind === 'cycle' ? '标签父级关系存在循环' : `父标签不存在：${parent}` })
      items.push({
        id: tagNodeId(setting.id, tag),
        title: tag,
        category: setting.category,
        tags: [],
        parentId: valid && typeof parent === 'string' ? tagNodeId(setting.id, parent) : setting.id,
        kind: 'tag'
      })
    }
  }
  return { items, warnings }
}

/** Make an acyclic parent map from old or manually edited setting files. */
function safeParents(items: SettingsTreeItem[]): {
  parents: Map<string, string>
  warnings: SettingsTreeWarning[]
} {
  const byId = new Map(items.map((item) => [item.id, item]))
  const parents = new Map<string, string>()
  const warnings: SettingsTreeWarning[] = []

  for (const item of items) {
    const parentId = normalizedParentId(item)
    if (!parentId) continue
    if (!byId.has(parentId)) {
      warnings.push({
        nodeId: item.id,
        kind: 'orphan',
        message: `父级设定不存在：${parentId}`
      })
    } else {
      parents.set(item.id, parentId)
    }
  }

  const processed = new Set<string>()
  for (const item of items) {
    if (processed.has(item.id)) continue
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let currentId: string | undefined = item.id

    while (currentId && !processed.has(currentId)) {
      const cycleStart = pathIndex.get(currentId)
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart)
        const rootId = cycle.map((id) => byId.get(id)!).sort(compareSettings)[0].id
        parents.delete(rootId)
        warnings.push({
          nodeId: rootId,
          kind: 'cycle',
          message: '设定父级关系存在循环'
        })
        break
      }
      pathIndex.set(currentId, path.length)
      path.push(currentId)
      currentId = parents.get(currentId)
    }

    for (const id of path) processed.add(id)
  }

  return { parents, warnings }
}

/** Build a deterministic horizontal forest, including safe roots for damaged relationships. */
export function buildSettingsTree(input: readonly SettingsTreeItem[]): SettingsTreeGraph {
  if (input.length === 0) return { nodes: [], edges: [], warnings: [], width: 0, height: 0 }

  const expanded = expandedTags(input)
  const items = expanded.items.sort(compareSettings)
  const byId = new Map(items.map((item) => [item.id, item]))
  const { parents, warnings: parentWarnings } = safeParents(items)
  const warnings = [...expanded.warnings, ...parentWarnings]
  const childrenByParent = new Map<string, string[]>()
  const roots: string[] = []

  for (const item of items) {
    const parentId = parents.get(item.id)
    if (!parentId) {
      roots.push(item.id)
    } else {
      const children = childrenByParent.get(parentId) ?? []
      children.push(item.id)
      childrenByParent.set(parentId, children)
    }
  }

  const nodes: SettingsTreeNode[] = []
  const edges: SettingsTreeEdge[] = []
  const nodeById = new Map<string, SettingsTreeNode>()
  const visited = new Set<string>()
  let nextLeafRow = 0

  for (const rootId of roots) {
    const stack: { id: string; depth: number; exit: boolean }[] = [
      { id: rootId, depth: 0, exit: false }
    ]

    while (stack.length > 0) {
      const frame = stack.pop()!
      const children = childrenByParent.get(frame.id) ?? []

      if (frame.exit) {
        const node = nodeById.get(frame.id)!
        node.position.y = children.length > 0
          ? children.reduce((total, id) => total + nodeById.get(id)!.position.y, 0) / children.length
          : nextLeafRow++ * SETTING_ROW_GAP
        continue
      }

      if (visited.has(frame.id)) continue
      visited.add(frame.id)
      const item = byId.get(frame.id)!
      const node: SettingsTreeNode = {
        id: item.id,
        title: item.title,
        category: item.category,
        tags: [...item.tags],
        kind: item.kind,
        parentId: normalizedParentId(item),
        depth: frame.depth,
        position: { x: frame.depth * SETTING_LEVEL_GAP, y: 0 }
      }
      nodes.push(node)
      nodeById.set(node.id, node)

      const parentId = parents.get(frame.id)
      if (parentId) {
        edges.push({ id: `setting:${parentId}:${frame.id}`, source: parentId, target: frame.id })
      }

      stack.push({ ...frame, exit: true })
      for (let index = children.length - 1; index >= 0; index--) {
        stack.push({ id: children[index], depth: frame.depth + 1, exit: false })
      }
    }
  }

  return {
    nodes,
    edges,
    warnings,
    width: Math.max(...nodes.map((node) => node.position.x + SETTING_NODE_WIDTH)),
    height: Math.max(...nodes.map((node) => node.position.y + SETTING_NODE_HEIGHT))
  }
}

/** Return the stable set of roots after orphan and cycle protection is applied. */
export function settingsTreeRootIds(input: readonly SettingsTreeItem[]): string[] {
  const items = sortedSettings(input)
  if (items.length === 0) return []
  const { parents } = safeParents(items)
  return items.filter((item) => !parents.has(item.id)).map((item) => item.id)
}

/**
 * Select one setting and its descendants for a focused chart.
 * The selected setting is detached from its original parent so it becomes the
 * root of the focused graph without changing persisted metadata.
 */
export function settingsTreeItems(input: readonly SettingsTreeItem[], rootId?: string): SettingsTreeItem[] {
  const items = sortedSettings(input)
  if (!rootId) return items

  const byId = new Map(items.map((item) => [item.id, item]))
  if (!byId.has(rootId)) return []

  const { parents } = safeParents(items)
  const childrenByParent = new Map<string, string[]>()
  for (const [childId, parentId] of parents) {
    const children = childrenByParent.get(parentId) ?? []
    children.push(childId)
    childrenByParent.set(parentId, children)
  }

  const selected = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (selected.has(id)) continue
    selected.add(id)
    stack.push(...(childrenByParent.get(id) ?? []))
  }

  return items
    .filter((item) => selected.has(item.id))
    .map((item) => {
      if (item.id !== rootId) return item
      const { parentId: _parentId, ...root } = item
      return root
    })
}

/** Return valid parent ids in the same stable title order as the tree. */
export function availableParentIds(input: readonly SettingsTreeItem[], currentId?: string): string[] {
  const items = sortedSettings(input)
  if (!currentId) return items.map((item) => item.id)

  const childrenByParent = new Map<string, string[]>()
  for (const item of items) {
    const parentId = normalizedParentId(item)
    if (!parentId) continue
    const children = childrenByParent.get(parentId) ?? []
    children.push(item.id)
    childrenByParent.set(parentId, children)
  }

  const excluded = new Set<string>()
  const stack = [currentId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (excluded.has(id)) continue
    excluded.add(id)
    stack.push(...(childrenByParent.get(id) ?? []))
  }

  return items.filter((item) => !excluded.has(item.id)).map((item) => item.id)
}

/** A tag cannot be placed below itself or any of its descendants. */
export function availableTagParentNames(tags: readonly string[], tagParents: Record<string, string> | undefined, child: string): string[] {
  return tags.filter((candidate) => {
    if (candidate === child) return false
    const visited = new Set<string>()
    let current: string | undefined = candidate
    while (current && !visited.has(current)) {
      if (current === child) return false
      visited.add(current)
      current = tagParents && Object.hasOwn(tagParents, current) ? tagParents[current] : undefined
    }
    return true
  })
}
