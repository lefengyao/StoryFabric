import { describe, expect, it } from 'vitest'
import { MainRuntimeEvents } from '../runtimeEvents'

describe('main runtime event compatibility', () => {
  it('preserves the agent identity of a structured question event', () => {
    const events = new MainRuntimeEvents()
    const envelope = events.append('workspace-1', 'session-1', 'run-1', {
      type: 'agent-question',
      question: {
        questionId: 'question-1',
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'basic',
        title: '确认',
        description: '请选择',
        fields: [{ id: 'choice', label: '选择', type: 'single', options: [{ id: 'yes', label: '是' }] }]
      }
    })

    expect(envelope).toMatchObject({
      agentId: 'basic',
      event: { type: 'agent-question', payload: { questionId: 'question-1' } }
    })
  })

  it('preserves the stage identity of stage lifecycle events', () => {
    const events = new MainRuntimeEvents()
    const envelope = events.append('workspace-1', 'session-1', 'run-1', { type: 'stage-start', stageId: 'plan' })

    expect(envelope).toMatchObject({
      stageId: 'plan',
      event: { type: 'stage-start', payload: { stageId: 'plan' } }
    })
  })

  it('evicts old run buffers once the tracking limit is reached', () => {
    const events = new MainRuntimeEvents({ maxRuns: 2 })
    events.append('workspace-1', 'session-1', 'run-1', { type: 'stage-start', stageId: 'plan' })
    events.append('workspace-1', 'session-1', 'run-2', { type: 'stage-start', stageId: 'plan' })
    events.append('workspace-1', 'session-1', 'run-3', { type: 'stage-start', stageId: 'plan' })

    expect(events.replay('workspace-1', 'run-1', 0).events).toEqual([])
    expect(events.replay('workspace-1', 'run-3', 0).events).toHaveLength(1)
  })
})
