import { describe, expect, it, vi } from 'vitest'
import { AgentRuntime } from '../runtime'

describe('AgentRuntime', () => {
  it('does not start the model runner twice for a duplicate client run id', async () => {
    const runtime = new AgentRuntime({ idFactory: () => 'run-1', now: () => 100 })
    const runner = vi.fn(async () => undefined)

    const first = runtime.start({ workspaceId: 'w', sessionId: 's', clientRunId: 'c', agentId: 'basic' }, runner)
    const duplicate = runtime.start({ workspaceId: 'w', sessionId: 's', clientRunId: 'c', agentId: 'basic' }, runner)
    await first.done
    await duplicate.done

    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, runId: first.runId })
    expect(runner).toHaveBeenCalledOnce()
  })

  it('preserves partial text when a run is cancelled and emits one terminal event', async () => {
    const runtime = new AgentRuntime({ idFactory: () => 'run-cancel', now: () => 100 })
    let release: (() => void) | undefined
    const runner = () => new Promise<void>((resolve) => { release = resolve })
    const started = runtime.start({ workspaceId: 'w', sessionId: 's', agentId: 'basic' }, async (context) => {
      context.text('msg-1', '前半章')
      await runner()
    })

    runtime.cancel(started.runId)
    release?.()
    await started.done

    const snapshot = runtime.getSnapshot(started.runId)
    expect(snapshot?.status).toBe('cancelled')
    expect(snapshot?.drafts).toEqual([{ messageId: 'msg-1', text: '前半章' }])
    expect(snapshot?.events.filter((event) => event.event.type === 'run-done' || event.event.type === 'run-error' || event.event.type === 'run-paused')).toHaveLength(1)
  })

  it('rejects a second parent run for the same workspace and session', () => {
    const runtime = new AgentRuntime({ idFactory: (() => { let n = 0; return () => `run-${++n}` })() })
    const never = () => new Promise<void>(() => undefined)
    runtime.start({ workspaceId: 'w', sessionId: 's', agentId: 'basic' }, never)

    expect(() => runtime.start({ workspaceId: 'w', sessionId: 's', agentId: 'basic' }, never)).toThrow(/运行|run|会话/)
  })
})
