import { describe, expect, it } from 'vitest'
import type { RunEventEnvelope } from '../../../shared/agentRuntime'
import { RunEventLedger } from '../events'

describe('RunEventLedger recovery', () => {
  it('continues sequence numbers after restoring persisted events', () => {
    const first = new RunEventLedger(() => 100)
    const event = first.append({
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'write',
      stageId: 'write',
      event: { type: 'waiting-user', payload: { questionId: 'q1' } }
    })
    const restored = new RunEventLedger(() => 100, [event as RunEventEnvelope])
    const next = restored.append({
      workspaceId: 'w',
      sessionId: 's',
      runId: 'r',
      agentId: 'write',
      stageId: 'write',
      event: { type: 'run-done', payload: { status: 'completed' } }
    })

    expect(next.seq).toBe(2)
    expect(restored.lastSeq).toBe(2)
  })
})
