export interface Change {
  id: string
  path: string
  before: string
  after: string
  baseRevision: number
  dependsOn?: string[]
}

export interface ChangeSet { id: string; workspaceId: string; runId: string; changes: Change[] }
export interface DocumentState { text: string; revision: number }
export interface CommitResult { status: 'applied' | 'rejected' | 'conflict' | 'failed'; changeSetId: string; appliedIds: string[]; message: string }

export class CommitCoordinator {
  private readonly documents = new Map<string, DocumentState>()
  private readonly results = new Map<string, CommitResult>()

  constructor(initial: Record<string, DocumentState>) {
    for (const [path, state] of Object.entries(initial)) this.documents.set(path, { ...state })
  }

  edit(path: string, text: string): void {
    const current = this.documents.get(path)
    if (!current) throw new Error('文档不存在')
    current.text = text
    current.revision += 1
  }

  get(path: string): DocumentState | undefined {
    const value = this.documents.get(path)
    return value ? { ...value } : undefined
  }

  async confirm(changeSet: ChangeSet, options: { selectedIds?: string[] } = {}): Promise<CommitResult> {
    const previous = this.results.get(changeSet.id)
    if (previous) return { ...previous, appliedIds: [...previous.appliedIds] }
    const selected = new Set(options.selectedIds ?? changeSet.changes.map((change) => change.id))
    const selectedChanges = changeSet.changes.filter((change) => selected.has(change.id))
    const selectedIds = new Set(selectedChanges.map((change) => change.id))
    const missingDependency = selectedChanges.find((change) => (change.dependsOn ?? []).some((dependency) => !selectedIds.has(dependency)))
    if (missingDependency) return this.remember(changeSet.id, { status: 'rejected', changeSetId: changeSet.id, appliedIds: [], message: `变更 ${missingDependency.id} 缺少依赖闭包` })
    const conflict = selectedChanges.find((change) => {
      const current = this.documents.get(change.path)
      return !current || current.revision !== change.baseRevision || current.text !== change.before
    })
    if (conflict) return this.remember(changeSet.id, { status: 'conflict', changeSetId: changeSet.id, appliedIds: [], message: `文档已改变：${conflict.path}` })
    for (const change of selectedChanges) {
      const current = this.documents.get(change.path)!
      current.text = change.after
      current.revision += 1
    }
    return this.remember(changeSet.id, { status: 'applied', changeSetId: changeSet.id, appliedIds: selectedChanges.map((change) => change.id), message: '候选变更已应用' })
  }

  private remember(id: string, result: CommitResult): CommitResult { this.results.set(id, result); return { ...result, appliedIds: [...result.appliedIds] } }
}
