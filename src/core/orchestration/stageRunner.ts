import { createArtifact } from './artifacts'
import { assembleStageContext } from './contextAssembler'
import type { DraftOverlay } from './draftOverlay'
import type { Artifact, StageDefinition, SourceRevision } from './types'

export interface StageCall { stageId: StageDefinition['stageId']; prompt: string; runId: string }
export interface StageRunnerOptions { call(input: StageCall): Promise<{ text?: string; payload?: unknown }> }

export async function runStage(options: StageRunnerOptions, input: { runId: string; sourceRevision: SourceRevision; goal: string; originalText: string; stage: StageDefinition; artifacts: Artifact[]; overlay: DraftOverlay }): Promise<Artifact> {
  const prompt = assembleStageContext({ ...input, stageId: input.stage.stageId })
  const result = await options.call({ stageId: input.stage.stageId, prompt, runId: input.runId })
  const artifact = createArtifact({ runId: input.runId, stageId: input.stage.stageId, kind: input.stage.kind, inputArtifactIds: input.artifacts.map((item) => item.id), sourceRevisions: { source: input.sourceRevision }, text: result.text, payload: result.payload })
  if (input.stage.stageId === 'setting') input.overlay.propose('setting', result.text ?? result.payload)
  return artifact
}
