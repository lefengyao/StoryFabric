export interface SourceRef {
  workspaceId: string
  sourcePath: string
  entityId?: string
  revision: string
  offset: number
  length: number
  complete: boolean
}

export interface ToolReceipt {
  runId: string
  stageId: string
  agentId: string
  callId: string
  toolName: string
  status: 'read' | 'pending' | 'applied' | 'rejected' | 'failed'
  sources: SourceRef[]
  errorCode?: string
}

export interface RequestContextUsage {
  requestId: string
  runId: string
  stageId?: string
  agentId: string
  model: string
  estimatedInputTokens: number
  reservedOutputTokens: number
  contextLimit: number
  sourceTokens?: number
  skillTokens?: number
  historyTokens?: number
  artifactTokens?: number
  actualPromptTokens?: number
  actualCompletionTokens?: number
}

export interface AppliedSkillRef {
  libraryId: string
  packageId: string
  skillId: string
  version: string
  contentHash: string
  reason: string
}

export interface SkillApplicationEvent {
  runId: string
  stageId?: string
  agentId: string
  status: 'checked' | 'matched' | 'loaded' | 'applied' | 'none' | 'failed'
  skills: AppliedSkillRef[]
  requestId?: string
}
