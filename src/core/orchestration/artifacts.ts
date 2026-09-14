import type { Artifact, ArtifactKind, StageId } from './types'

function hash(text: string): string {
  let result = 2166136261
  for (let index = 0; index < text.length; index++) { result ^= text.charCodeAt(index); result = Math.imul(result, 16777619) }
  return (result >>> 0).toString(16).padStart(8, '0')
}

export function createArtifact(input: { runId: string; stageId: StageId; agentId?: string; kind: ArtifactKind; version?: number; inputArtifactIds?: string[]; sourceRevisions?: Record<string, number>; text?: string; payload?: unknown }): Artifact {
  const body = input.text ?? JSON.stringify(input.payload ?? null)
  return {
    id: `artifact_${input.runId}_${input.stageId}_${input.version ?? 1}`,
    runId: input.runId,
    stageId: input.stageId,
    agentId: input.agentId ?? input.stageId,
    version: input.version ?? 1,
    kind: input.kind,
    status: 'candidate',
    inputArtifactIds: input.inputArtifactIds ?? [],
    sourceRevisions: input.sourceRevisions ?? {},
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    contentHash: hash(body),
    createdAt: Date.now()
  }
}
