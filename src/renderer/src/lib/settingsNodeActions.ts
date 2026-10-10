import type { StoryFabricApi } from '../../../shared/api'
import type { SettingDoc } from '../../../shared/types'
import type { SettingsTreeNode } from './settingsTree'

type NodeApi = Pick<StoryFabricApi, 'getSetting' | 'saveSetting' | 'deleteSetting'>

export interface SettingsNodeDraft {
  title: string
  summary: string
  content: string
}

async function loadNodeSetting(api: NodeApi, node: SettingsTreeNode): Promise<SettingDoc> {
  const id = node.kind === 'tag' ? node.settingId : node.id
  const doc = id ? await api.getSetting(id) : null
  if (!doc || (node.kind === 'tag' && !doc.tags.includes(node.title))) {
    throw new Error('该节点已不存在，请刷新图表后重试')
  }
  return doc
}

/** Add a three-part tag node directly below the clicked node. */
export async function addSettingsChildNode(api: NodeApi, parent: SettingsTreeNode, draft: SettingsNodeDraft): Promise<SettingDoc> {
  const title = draft.title.trim()
  if (!title) throw new Error('请输入子节点标题')
  const doc = await loadNodeSetting(api, parent)
  if (doc.tags.includes(title)) throw new Error('同一设定下已存在这个标题，请使用不同标题')
  const tagParents = Object.fromEntries([
    ...Object.entries(doc.tagParents ?? {}),
    ...(parent.kind === 'tag' ? [[title, parent.title]] : [])
  ])
  return api.saveSetting({
    id: doc.id,
    tags: [...doc.tags, title],
    tagParents,
    tagDetails: { ...doc.tagDetails, [title]: { summary: draft.summary, content: draft.content } }
  })
}

/** Remove one tag, retaining its descendants; whole settings use the trash API. */
export async function deleteSettingsNode(api: NodeApi, node: SettingsTreeNode): Promise<SettingDoc | null> {
  const doc = await loadNodeSetting(api, node)
  if (node.kind !== 'tag') {
    await api.deleteSetting(doc.id)
    return null
  }
  const parents = doc.tagParents ?? {}
  const parent = Object.hasOwn(parents, node.title) ? parents[node.title] : undefined
  const tagParents = Object.fromEntries(Object.entries(parents)
    .filter(([child]) => child !== node.title)
    .flatMap(([child, currentParent]) => {
      if (currentParent !== node.title) return [[child, currentParent]]
      return parent && parent !== node.title && doc.tags.includes(parent) ? [[child, parent]] : []
    }))
  return api.saveSetting({
    id: doc.id,
    tags: doc.tags.filter((tag) => tag !== node.title),
    tagParents,
    tagDetails: Object.fromEntries(Object.entries(doc.tagDetails ?? {}).filter(([title]) => title !== node.title))
  })
}
