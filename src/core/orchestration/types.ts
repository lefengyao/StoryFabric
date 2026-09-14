export type StageId = 'plan' | 'setting' | 'prompt' | 'anti-ai' | 'write' | 'polish' | 'review'
export type ArtifactKind = 'plan' | 'setting-proposal' | 'writing-brief' | 'style-guidance' | 'draft' | 'polished' | 'review'
export type StageStatus = 'pending' | 'running' | 'waiting_user' | 'completed' | 'skipped' | 'failed' | 'cancelled' | 'stale'

export interface StageDefinition { stageId: StageId; kind: ArtifactKind; dependsOn: StageId[]; required: boolean }
export interface StageState { stageId: StageId; status: StageStatus; reason?: string; artifactId?: string }
export interface Artifact {
  id: string
  runId: string
  stageId: StageId
  agentId: string
  version: number
  kind: ArtifactKind
  status: 'candidate' | 'accepted' | 'stale'
  inputArtifactIds: string[]
  sourceRevisions: Record<string, number>
  text?: string
  payload?: unknown
  contentHash: string
  createdAt: number
}
