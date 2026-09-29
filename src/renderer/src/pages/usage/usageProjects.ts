import type { WorkspaceListItem } from '../../../../shared/types'

export interface UsageProjectOption {
  id: string
  name: string
}

export function usageProjectOptions(records: Array<{ workspaceId?: string }>, known: WorkspaceListItem[], current?: Pick<WorkspaceListItem, 'name' | 'path'> | null): UsageProjectOption[] {
  const names = new Map<string, string>()
  for (const workspace of known) {
    if (workspace.path) names.set(workspace.path, workspace.name || workspace.path)
  }
  if (current?.path) names.set(current.path, current.name || current.path)
  for (const record of records) {
    const id = record.workspaceId
    if (id && !names.has(id)) names.set(id, id.split(/[\\/]/).filter(Boolean).at(-1) || id)
  }
  return [...names].map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
}
