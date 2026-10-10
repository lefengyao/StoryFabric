import { describe, expect, it } from 'vitest'
import {
  normalizeAgentMode,
  normalizeApprovalPolicy,
  validateGoalTasks
} from '../creative'
import { validateRuntimeEvent } from '../agentRuntime'

describe('goal contracts', () => {
  it('defaults legacy requests to normal mode and strict approval', () => {
    expect(normalizeAgentMode(undefined)).toBe('normal')
    expect(normalizeApprovalPolicy(undefined)).toBe('strict')
  })

  it('rejects goal plans with missing dependencies, cycles, or empty acceptance criteria', () => {
    expect(() => validateGoalTasks([{ id: 'a', title: 'A', instructions: 'x', acceptanceCriteria: [], dependsOn: [] }])).toThrow()
    expect(() => validateGoalTasks([
      { id: 'a', title: 'A', instructions: 'x', acceptanceCriteria: ['done'], dependsOn: ['b'] },
      { id: 'b', title: 'B', instructions: 'x', acceptanceCriteria: ['done'], dependsOn: ['a'] }
    ])).toThrow(/依赖|循环/)
  })

  it('validates target runtime events without accepting unknown event types', () => {
    expect(() => validateRuntimeEvent({ type: 'goal-task', payload: { goalId: 'g', taskId: 't', status: 'running' } })).not.toThrow()
    expect(() => validateRuntimeEvent({ type: 'goal-unknown' })).toThrow()
  })
})
