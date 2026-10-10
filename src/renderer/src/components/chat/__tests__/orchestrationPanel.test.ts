import { describe, expect, it } from 'vitest'
import { DEFAULT_ORCHESTRATION_PREFERENCES } from '../../../../../shared/creative'
import { budgetLimitHint, buildOrchestrationPanelModel, mergeStageSnapshots } from '../OrchestrationPanel'

describe('orchestration panel model', () => {
  it('exposes the total token ceiling and each configured orchestration agent', () => {
    const model = buildOrchestrationPanelModel({
      ...DEFAULT_ORCHESTRATION_PREFERENCES,
      enabled: true,
      subagentsEnabled: true,
      enabledStageIds: ['plan', 'write'],
      modelByStage: { write: { providerId: 'writer', model: 'writer-model' } },
      maxCalls: 12,
      maxEstimatedTokens: 300000
    }, { providerId: 'chat', model: 'chat-model' }, undefined)

    expect(model.maxCalls).toBe(12)
    expect(model.maxEstimatedTokens).toBe(300000)
    expect(model.agents).toEqual([
      expect.objectContaining({ id: 'plan', label: '计划', model: 'chat-model', status: '未运行' }),
      expect.objectContaining({ id: 'write', label: '正文写作', model: 'writer-model', status: '未运行' }),
      expect.objectContaining({ id: 'subagent:continuity', label: '连续性核对', model: 'chat-model', status: '只读协作' }),
      expect.objectContaining({ id: 'subagent:style', label: '文风核对', model: 'chat-model', status: '只读协作' })
    ])
  })

  it('uses live or persisted stage status when available', () => {
    const model = buildOrchestrationPanelModel({
      ...DEFAULT_ORCHESTRATION_PREFERENCES,
      enabledStageIds: ['plan', 'write']
    }, { providerId: 'chat', model: 'chat-model' }, {
      stages: [
        { stageId: 'plan', status: 'completed' },
        { stageId: 'write', status: 'running' }
      ]
    })

    expect(model.agents.map((agent) => [agent.id, agent.status])).toEqual([
      ['plan', '已完成'],
      ['write', '进行中']
    ])
  })

  it('merges live stage status over the persisted run instead of hiding completed stages', () => {
    const snapshot = mergeStageSnapshots(
      [
        { stageId: 'plan', status: 'completed' },
        { stageId: 'setting', status: 'pending' },
        { stageId: 'write', status: 'pending' }
      ],
      [{ stageId: 'setting', status: 'running' }]
    )

    expect(snapshot?.stages).toEqual([
      { stageId: 'plan', status: 'completed' },
      { stageId: 'setting', status: 'running' },
      { stageId: 'write', status: 'pending' }
    ])
  })

  it('explains that a call ceiling is separate from a large Token ceiling', () => {
    expect(budgetLimitHint('模型调用预算不足：调用次数（调用 24/24；估算 Token 1200000/30000000）')).toContain('最大模型调用次数')
    expect(budgetLimitHint('模型调用预算不足：估计 token（调用 4/24；估算 Token 30000000/30000000）')).toContain('预计 Token 上限')
  })
})
