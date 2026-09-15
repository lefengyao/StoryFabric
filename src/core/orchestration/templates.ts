import type { StageDefinition, StageId } from './types'

export const SEVEN_STAGE_TEMPLATE: StageDefinition[] = [
  { stageId: 'plan', kind: 'plan', dependsOn: [], required: true },
  { stageId: 'setting', kind: 'setting-proposal', dependsOn: ['plan'], required: false },
  { stageId: 'prompt', kind: 'writing-brief', dependsOn: ['plan'], required: false },
  { stageId: 'anti-ai', kind: 'style-guidance', dependsOn: ['prompt'], required: true },
  { stageId: 'write', kind: 'draft', dependsOn: ['plan'], required: true },
  { stageId: 'polish', kind: 'polished', dependsOn: ['write'], required: false },
  { stageId: 'review', kind: 'review', dependsOn: ['write'], required: true }
]

export function stageDefinition(stageId: StageId): StageDefinition {
  const stage = SEVEN_STAGE_TEMPLATE.find((item) => item.stageId === stageId)
  if (!stage) throw new Error(`未知阶段：${stageId}`)
  return stage
}
