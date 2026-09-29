import { describe, expect, it } from 'vitest'
import { agentStageLabel, agentThinkingLabel } from '../agentStagePresentation'

describe('agent stage presentation', () => {
  it('shows named chapter agents together with the actual model', () => {
    expect(agentStageLabel('polish')).toBe('AI 润色智能体')
    expect(agentStageLabel('anti-ai')).toBe('去 AI 风格智能体')
    expect(agentThinkingLabel('polish', 'writer-model')).toBe('AI 润色智能体 · writer-model 正在工作')
    expect(agentThinkingLabel('anti-ai', 'writer-model')).toBe('去 AI 风格智能体 · writer-model 正在工作')
  })
})
