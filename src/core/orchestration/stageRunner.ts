import { createArtifact } from './artifacts'
import { validateArtifactOutput } from './artifactValidation'
import { assembleStageContext } from './contextAssembler'
import type { DraftOverlay } from './draftOverlay'
import type { Artifact, StageDefinition, StageId, SourceRevision } from './types'

export interface StageCall { stageId: StageDefinition['stageId']; prompt: string; runId: string; planningGate: { open: boolean; missing: StageId[] } }
export interface StageRunnerOptions {
  call(input: StageCall): Promise<{ text?: string; payload?: unknown; hasToolReceipt?: boolean }>
  onStageComplete?: (stageId: StageDefinition['stageId'], artifactId: string) => void
}

export async function runStage(options: StageRunnerOptions, input: { runId: string; sourceRevision: SourceRevision; goal: string; originalText: string; history?: string; stage: StageDefinition; artifacts: Artifact[]; overlay: DraftOverlay }): Promise<Artifact> {
  const requiredForWrite = input.stage.requiredForWrite ?? []
  const missing = requiredForWrite.filter((stageId) => !input.artifacts.some((artifact) => artifact.stageId === stageId && artifact.status !== 'stale'))
  const planningGate = { open: input.stage.stageId !== 'write' || missing.length === 0, missing }
  if (!planningGate.open) throw new Error(`正文写作门禁未开启，缺少：${missing.join('、')}`)
  const prompt = assembleStageContext({ ...input, stageId: input.stage.stageId })
  const result = await options.call({ stageId: input.stage.stageId, prompt, runId: input.runId, planningGate })
  const validation = validateArtifactOutput({
    stageId: input.stage.stageId,
    kind: input.stage.kind,
    text: result.text,
    hasToolReceipt: result.hasToolReceipt
  })
  if (!validation.ok) throw new Error(validation.reason)
  const artifact = createArtifact({ runId: input.runId, stageId: input.stage.stageId, kind: input.stage.kind, inputArtifactIds: input.artifacts.map((item) => item.id), sourceRevisions: { source: input.sourceRevision }, text: result.text, payload: result.payload })
  if (input.stage.stageId === 'setting') input.overlay.propose('setting', result.text ?? result.payload)
  options.onStageComplete?.(input.stage.stageId, artifact.id)
  return artifact
}
