import { expect, it } from 'vitest'
import type { RunReplay } from '../../../../shared/runEvents'
import { recoverActiveRun, useRunStore } from '../runStore'

it('rebuilds renderer partials from ordered events and keeps failed terminal state', () => {
  useRunStore.getState().clear()
  const emit = (seq: number, event: Parameters<ReturnType<typeof useRunStore.getState>['applyEvent']>[0]['event']) => {
    useRunStore.getState().applyEvent({ schemaVersion: 1, workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'a', seq, at: 0, event })
  }

  emit(2, { type: 'text-delta', messageId: 'm', delta: '乙' })
  emit(1, { type: 'text-delta', messageId: 'm', delta: '甲' })
  emit(3, { type: 'run-error' })
  emit(4, { type: 'run-done', payload: { status: 'failed' } })

  expect(useRunStore.getState().runs.r.partialByMessage['w:r:a:m']).toBe('甲乙')
  expect(useRunStore.getState().runs.r.status).toBe('failed')
})

it('does not reactivate a completed run when its older start event arrives late', () => {
  useRunStore.getState().clear()
  const base = { schemaVersion: 1 as const, workspaceId: 'w', sessionId: 's', agentId: 'a', at: 0 }
  useRunStore.getState().applyEvent({ ...base, runId: 'old-run', seq: 2, event: { type: 'run-done', payload: { status: 'completed' } } })
  useRunStore.getState().applyEvent({ ...base, runId: 'new-run', seq: 1, event: { type: 'run-start' } })
  useRunStore.getState().applyEvent({ ...base, runId: 'old-run', seq: 1, event: { type: 'run-start' } })

  expect(useRunStore.getState().runs['old-run'].status).toBe('completed')
  expect(useRunStore.getState().activeRunId).toBe('new-run')
})

it('keeps identical message ids separate when child agents interleave', () => {
  useRunStore.getState().clear()
  const apply = useRunStore.getState().applyEvent
  const base = { schemaVersion: 1 as const, workspaceId: 'w', sessionId: 's', runId: 'r', seq: 1, at: 0 }
  apply({ ...base, agentId: 'child-a', event: { type: 'text-delta', messageId: 'same', delta: '甲' } })
  apply({ ...base, seq: 2, agentId: 'child-b', event: { type: 'text-delta', messageId: 'same', delta: '一' } })
  apply({ ...base, seq: 3, agentId: 'child-a', event: { type: 'text-delta', messageId: 'same', delta: '乙' } })
  apply({ ...base, seq: 4, agentId: 'child-b', event: { type: 'text-delta', messageId: 'same', delta: '二' } })

  expect(useRunStore.getState().runs.r.partialByMessage).toMatchObject({ 'w:r:child-a:same': '甲乙', 'w:r:child-b:same': '一二' })
})

it('marks a run as awaiting the user for a structured question and resumes on the next delta', () => {
  useRunStore.getState().clear()
  const base = { schemaVersion: 1 as const, workspaceId: 'w', sessionId: 's', runId: 'r-question', agentId: 'planner', at: 0 }
  useRunStore.getState().applyEvent({ ...base, seq: 1, event: { type: 'agent-question', payload: { questionId: 'q-1', question: { questionId: 'q-1', runId: 'r-question', sessionId: 's', agentId: 'planner', title: '选择', description: '选择', fields: [{ id: 'x', label: 'x', type: 'text' }] } } } })
  expect(useRunStore.getState().runs['r-question'].status).toBe('awaiting_user')
  useRunStore.getState().applyEvent({ ...base, seq: 2, event: { type: 'text-delta', messageId: 'm', delta: '继续' } })
  expect(useRunStore.getState().runs['r-question'].status).toBe('running')
})

it('promotes the latest runtime run and replays only events after the last applied sequence', async () => {
  useRunStore.getState().clear()
  const first = { schemaVersion: 1 as const, workspaceId: 'w', sessionId: 's', runId: 'r-live', agentId: 'orchestration', seq: 1, at: 0, event: { type: 'run-start' as const } }
  useRunStore.getState().applyEvent(first)

  const replay: RunReplay = {
    replayable: true,
    snapshotSeq: 3,
    events: [
      { ...first, seq: 2, event: { type: 'stage-start', payload: { stageId: 'plan' } } },
      { ...first, seq: 3, event: { type: 'run-paused', payload: { reason: 'budget', message: '调用次数已达上限' } } }
    ]
  }
  const calls: number[] = []
  await recoverActiveRun({
    recoverRunEvents: async (_runId, afterSeq) => {
      calls.push(afterSeq ?? -1)
      return replay
    }
  })

  expect(calls).toEqual([1])
  expect(useRunStore.getState().activeRunId).toBe('r-live')
  expect(useRunStore.getState().runs['r-live'].events.map((event) => event.seq)).toEqual([1, 2, 3])
  expect(useRunStore.getState().runs['r-live'].status).toBe('paused')
})

it('keeps high-volume chapter tool streaming bounded while preserving the latest sequence', () => {
  useRunStore.getState().clear()
  const start = performance.now()
  for (let seq = 1; seq <= 5000; seq += 1) {
    useRunStore.getState().applyEvent({
      schemaVersion: 1,
      workspaceId: 'workspace',
      sessionId: 'session',
      runId: 'chapter-run',
      agentId: 'basic',
      seq,
      at: 0,
      event: { type: 'tool-generating', payload: { callId: 'save-chapter', argsDelta: '字' } }
    })
  }
  const state = useRunStore.getState().runs['chapter-run']
  expect(state.events.length).toBeLessThanOrEqual(2000)
  expect(state.events.at(-1)?.seq).toBe(5000)
  expect(performance.now() - start).toBeLessThan(1500)
})

it('ignores late events older than the evicted sequence window', () => {
  useRunStore.getState().clear()
  const base = { schemaVersion: 1 as const, workspaceId: 'workspace', sessionId: 'session', runId: 'evicted-run', agentId: 'basic', at: 0 }
  for (let seq = 1; seq <= 2001; seq += 1) {
    useRunStore.getState().applyEvent({ ...base, seq, event: { type: 'tool-complete', payload: { callId: `call-${seq}`, ok: true, resultPreview: '' } } })
  }
  useRunStore.getState().applyEvent({ ...base, seq: 1, event: { type: 'text-delta', messageId: 'late', delta: 'stale' } })

  const run = useRunStore.getState().runs['evicted-run']
  expect(run.events[0]?.seq).toBe(2)
  expect(run.partialBaseByMessage['workspace:evicted-run:basic:late']).toBeUndefined()
})

it('bounds retained event bytes and accumulated stream text per run', () => {
  useRunStore.getState().clear()
  for (let seq = 1; seq <= 4; seq += 1) {
    useRunStore.getState().applyEvent({
      schemaVersion: 1,
      workspaceId: 'workspace',
      sessionId: 'session',
      runId: 'large-run',
      agentId: 'basic',
      seq,
      at: seq,
      event: { type: 'text-delta', messageId: 'large-message', delta: 'x'.repeat(180_000) }
    })
  }

  const run = useRunStore.getState().runs['large-run']
  const retainedBytes = run.events.reduce((sum, event) => sum + new TextEncoder().encode(JSON.stringify(event)).byteLength, 0)
  expect(run.events.at(-1)?.seq).toBe(4)
  expect(retainedBytes).toBeLessThanOrEqual(512 * 1024)
  expect(run.partialByMessage['workspace:large-run:basic:large-message']?.length).toBeLessThanOrEqual(16_000)
  expect(run.partialBaseByMessage['workspace:large-run:basic:large-message']?.length).toBeLessThanOrEqual(16_000)
})

it('retains only the latest terminal runs while keeping an active run available', () => {
  useRunStore.getState().clear()
  const finish = (runId: string, seq: number) => {
    useRunStore.getState().begin(runId)
    useRunStore.getState().applyEvent({
      schemaVersion: 1,
      workspaceId: 'workspace',
      sessionId: 'session',
      runId,
      agentId: 'basic',
      seq,
      at: seq,
      event: { type: 'run-done', payload: { status: 'completed' } }
    })
  }

  for (let index = 1; index <= 10; index += 1) finish(`terminal-${index}`, index)
  const afterTerminals = useRunStore.getState()
  expect(Object.keys(afterTerminals.runs)).toHaveLength(8)
  expect(afterTerminals.runs['terminal-1']).toBeUndefined()
  expect(afterTerminals.runs['terminal-10']).toBeDefined()

  finish('active-run', 11)
  const finalState = useRunStore.getState()
  expect(finalState.runs['active-run']).toBeDefined()
  expect(Object.keys(finalState.runs).length).toBeLessThanOrEqual(8)
})

it('bounds retained non-terminal runs while keeping the active run available', () => {
  useRunStore.getState().clear()
  for (let index = 1; index <= 12; index += 1) {
    const runId = `waiting-${index}`
    const base = { schemaVersion: 1 as const, workspaceId: 'workspace', sessionId: `session-${index}`, runId, agentId: 'basic', at: index }
    useRunStore.getState().applyEvent({ ...base, seq: 1, event: { type: 'run-start' } })
    useRunStore.getState().applyEvent({ ...base, seq: 2, event: { type: 'run-paused', payload: { reason: 'budget', message: '等待继续' } } })
  }

  const state = useRunStore.getState()
  expect(Object.keys(state.runs)).toHaveLength(8)
  expect(state.runs['waiting-1']).toBeUndefined()
  expect(state.runs['waiting-12']?.status).toBe('paused')
  expect(state.activeRunId).toBe('waiting-12')
})

it('evicts old terminal runs while retaining the active run and recent history', () => {
  useRunStore.getState().clear()
  for (let index = 1; index <= 20; index += 1) {
    const runId = `run-${index}`
    const base = { schemaVersion: 1 as const, workspaceId: 'workspace', sessionId: 'session', runId, agentId: 'basic', at: 0 }
    useRunStore.getState().applyEvent({ ...base, seq: 1, event: { type: 'run-start' } })
    useRunStore.getState().applyEvent({ ...base, seq: 2, event: { type: 'run-done', payload: { status: 'completed' } } })
  }

  const runs = useRunStore.getState().runs
  expect(Object.keys(runs).length).toBeLessThanOrEqual(8)
  expect(runs['run-20']?.status).toBe('completed')
  expect(runs['run-1']).toBeUndefined()
})
