import type { Artifact } from './types'
import type { DraftOverlay } from './draftOverlay'

export function assembleStageContext(input: { goal: string; originalText: string; artifacts: Artifact[]; overlay: DraftOverlay; stageId: string }): string {
  const prior = input.artifacts.map((artifact) => `${artifact.stageId}: ${artifact.text ?? JSON.stringify(artifact.payload ?? '')}`).join('\n')
  const overlay = input.overlay.entries().map(([key, value]) => `${key}: ${String(value)}`).join('\n')
  return [`目标：${input.goal}`, `原文：${input.originalText}`, prior ? `上游产物：\n${prior}` : '', overlay ? `本次设定覆盖层：\n${overlay}` : '', `当前阶段：${input.stageId}`].filter(Boolean).join('\n\n')
}
