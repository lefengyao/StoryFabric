import { expect, it } from 'vitest'
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
  expect(result.stages.find((stage) => stage.stageId === 'write')?.status).toBe('completed')
  expect(result.businessText).toBe('初稿')
})
