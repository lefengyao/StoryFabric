import { expect, it } from 'vitest'
import { ModelCallBudgetError } from '../../agent/modelCallGateway'
import { OrchestrationScheduler } from '../scheduler'

it('runs the seven stages in order and keeps setting proposals in an overlay', async () => {
  const calls: string[] = []
  const scheduler = new OrchestrationScheduler({
    call: async ({ stageId }) => { calls.push(stageId); return { text: `${stageId} result` } }
  })
  const result = await scheduler.run({ runId: 'run-1', workspaceId: 'w', sourceRevision: 4, goal: '写一章', originalText: '' })

  expect(calls).toEqual(['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review'])
  expect(result.artifacts.map((artifact) => artifact.stageId)).toEqual(calls)
  expect(result.overlay.get('setting')).toBe('setting result')
  expect(result.businessText).toBe('')
})

it('marks a disabled upstream stage skipped and does not invent its artifact', async () => {
  const scheduler = new OrchestrationScheduler({ call: async ({ stageId }) => ({ text: stageId }) })
  const result = await scheduler.run({ runId: 'run-2', workspaceId: 'w', sourceRevision: 1, goal: '润色', originalText: '初稿', enabledStageIds: ['plan', 'write', 'review'] })

  expect(result.stages.find((stage) => stage.stageId === 'setting')?.status).toBe('skipped')
  expect(result.stages.find((stage) => stage.stageId === 'write')).toMatchObject({ status: 'stale' })
  expect(result.businessText).toBe('初稿')
})

it('continues through an optional stage failure so the executor can still receive later stage discussions', async () => {
  const calls: string[] = []
  const scheduler = new OrchestrationScheduler({
    call: async ({ stageId }) => {
      calls.push(stageId)
      if (stageId === 'setting') throw new Error('模型调用预算不足')
      return { text: `${stageId} result` }
    }
  })

  const result = await scheduler.run({ runId: 'run-optional-failure', workspaceId: 'w', sourceRevision: 1, goal: '优化章节', originalText: '初稿' })

  expect(calls).toEqual(['plan', 'setting', 'prompt', 'anti-ai'])
  expect(result.stages.find((stage) => stage.stageId === 'setting')).toMatchObject({ status: 'failed', reason: '模型调用预算不足' })
  expect(result.stages.find((stage) => stage.stageId === 'write')).toMatchObject({ status: 'stale' })
  expect(result.stages.find((stage) => stage.stageId === 'review')?.status).toBe('stale')
})

it('pauses the whole orchestration with an explicit budget state instead of marking a stage failed', async () => {
  const calls: string[] = []
  const scheduler = new OrchestrationScheduler({
    call: async ({ stageId }) => {
      calls.push(stageId)
      if (stageId === 'setting') throw new ModelCallBudgetError('tokens')
      return { text: `${stageId} result` }
    }
  })

  const result = await scheduler.run({ runId: 'run-budget-pause', workspaceId: 'w', sourceRevision: 1, goal: '优化章节', originalText: '初稿' })

  expect(calls).toEqual(['plan', 'setting'])
  expect(result.status).toBe('paused_budget')
  expect(result.error).toContain('预算')
  expect(result.stages.find((stage) => stage.stageId === 'setting')).toMatchObject({ status: 'paused_budget' })
  expect(result.stages.find((stage) => stage.stageId === 'write')).toMatchObject({ status: 'paused_budget' })
})
