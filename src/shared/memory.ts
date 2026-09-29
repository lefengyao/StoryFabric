export type MemoryScope = 'global' | 'project'

export interface MemorySnapshot {
  scope: MemoryScope
  enabled: boolean
  content: string
  revision: string
}

export interface MemoryUpdate {
  enabled?: boolean
  content?: string
  baseRevision: string
}
