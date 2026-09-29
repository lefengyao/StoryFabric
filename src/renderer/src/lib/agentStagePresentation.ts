const STAGE_LABELS: Record<string, string> = {
  plan: '计划智能体',
  setting: '设定智能体',
  prompt: '提示词智能体',
  'anti-ai': '去 AI 风格智能体',
  write: '正文写作智能体',
  polish: 'AI 润色智能体',
  review: '审查智能体',
  'subagent:continuity': '连续性核对智能体',
  'subagent:style': '文风核对智能体'
}

export function agentStageLabel(stageId: string): string {
  return STAGE_LABELS[stageId] ?? stageId
}

export function isOrdinaryChapterAgentStage(stageId: string | undefined): boolean {
  return stageId === 'polish' || stageId === 'anti-ai'
}

export function agentThinkingLabel(stageId: string | undefined, model: string): string {
  return isOrdinaryChapterAgentStage(stageId)
    ? `${agentStageLabel(stageId!)} · ${model} 正在工作`
    : `${model} 正在思考`
}
