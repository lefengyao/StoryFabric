import { DraftOverlay } from './draftOverlay'
import { createArtifact } from './artifacts'
import { SEVEN_STAGE_TEMPLATE } from './templates'
import { runStage, type StageRunnerOptions } from './stageRunner'
import type { Artifact, StageId, StageState, SourceRevision } from './types'

export interface OrchestrationInput { runId: string; workspaceId: string; sourceRevision: SourceRevision; goal: string; originalText: string; history?: string; enabledStageIds?: StageId[] }
export interface OrchestrationResult { stages: StageState[]; artifacts: Artifact[]; overlay: DraftOverlay; businessText: string; status: 'completed' | 'failed' | 'cancelled'; error?: string }

export class OrchestrationScheduler {
  constructor(private readonly runner: StageRunnerOptions) {}

  async run(input: OrchestrationInput): Promise<OrchestrationResult> {
    const enabled = new Set(input.enabledStageIds ?? SEVEN_STAGE_TEMPLATE.map((stage) => stage.stageId))
    const stages: StageState[] = []
    const artifacts: Artifact[] = []
    const overlay = new DraftOverlay()
    const disabledRequired = SEVEN_STAGE_TEMPLATE.filter((stage) => stage.required && !enabled.has(stage.stageId))
    for (const stage of SEVEN_STAGE_TEMPLATE) {
      if (!enabled.has(stage.stageId)) {
        stages.push({ stageId: stage.stageId, status: 'skipped', reason: '用户在启动前停用' })
        continue
      }
      if (stage.dependsOn.some((dependency) => disabledRequired.some((item) => item.stageId === dependency))) {
        stages.push({ stageId: stage.stageId, status: 'stale', reason: '上游必需阶段未启用' })
        continue
      }
      const missingRequiredDependency = stage.dependsOn.some((dependency) => {
        const dependencyState = stages.find((state) => state.stageId === dependency)
        const dependencyDefinition = SEVEN_STAGE_TEMPLATE.find((item) => item.stageId === dependency)
        return dependencyState?.status === 'failed' || dependencyState?.status === 'stale' || (dependencyState?.status === 'skipped' && dependencyDefinition?.required)
      })
      if (missingRequiredDependency) {
        stages.push({ stageId: stage.stageId, status: 'stale', reason: '上游必需阶段不可用' })
        continue
      }
      stages.push({ stageId: stage.stageId, status: 'running' })
      try {
        const artifact = await runStage(this.runner, { ...input, stage, artifacts, overlay })
        artifacts.push(artifact)
        const state = stages.find((item) => item.stageId === stage.stageId)!
        state.status = 'completed'
        state.artifactId = artifact.id
      } catch (error) {
        const state = stages.find((item) => item.stageId === stage.stageId)!
        const cancelled = (error as Error)?.name === 'AbortError'
        state.status = cancelled ? 'cancelled' : 'failed'
        state.reason = error instanceof Error ? error.message : String(error)
        const partialText = typeof (error as { partialText?: unknown })?.partialText === 'string'
          ? (error as { partialText: string }).partialText
          : ''
        if (partialText) {
          const partial = {
            runId: input.runId,
            stageId: stage.stageId,
            kind: stage.kind,
            text: partialText,
            inputArtifactIds: artifacts.map((item) => item.id),
            sourceRevisions: { source: input.sourceRevision }
          }
          const artifact = createArtifact(partial)
          artifacts.push(artifact)
          state.artifactId = artifact.id
        }
        if (stage.required) for (const later of SEVEN_STAGE_TEMPLATE.slice(SEVEN_STAGE_TEMPLATE.indexOf(stage) + 1)) stages.push({ stageId: later.stageId, status: 'stale', reason: `依赖 ${stage.stageId} 失败` })
        break
      }
    }
    const status = stages.some((stage) => stage.status === 'cancelled')
      ? 'cancelled'
      : stages.some((stage) => stage.status === 'failed' || stage.status === 'stale')
        ? 'failed'
        : 'completed'
    return { stages, artifacts, overlay, businessText: input.originalText, status }
  }
}
