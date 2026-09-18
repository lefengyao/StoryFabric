import { describe, expect, it, vi } from 'vitest'
import type { AgentQuestion } from '../../../shared/agentQuestions'
import { AgentRuntime } from '../runtime'
import { MemoryRunStore } from '../runStore'

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

  it('persists the current stage and an explicit budget pause for recovery', async () => {
    const runtime = new AgentRuntime({ idFactory: () => 'run-budget', now: () => 100 })
    const started = runtime.start({ workspaceId: 'w', sessionId: 's', agentId: 'orchestration' }, async (context) => {
      context.stage('setting')
      context.budget({ maxCalls: 1, maxEstimatedTokens: 1000, callsStarted: 1, callsSettled: 1, actualTokens: 0, estimatedTokens: 1000, reservedTokens: 0 })
      const error = Object.assign(new Error('模型调用预算不足：估计 token'), { code: 'BUDGET_EXCEEDED' })
      throw error
    })

    await started.done

    const snapshot = runtime.getSnapshot(started.runId)
    expect(snapshot).toMatchObject({ status: 'paused_budget', currentStage: 'setting', pauseReason: 'budget', error: '模型调用预算不足：估计 token' })
    expect(snapshot?.budget?.estimatedTokens).toBe(1000)
    expect(snapshot?.events.some((event) => event.event.type === 'run-paused')).toBe(true)
  })

  it('waits in awaiting_user, persists the question, and resumes the same run after one answer', async () => {
    const store = new MemoryRunStore()
    const runtime = new AgentRuntime({ store, idFactory: () => 'run-question', now: () => 100 })
    const question: AgentQuestion = {
      questionId: 'question-runtime',
      runId: 'run-question',
      sessionId: 's',
      stageId: 'write',
      agentId: 'write',
      title: '确认',
      description: '请确认',
      fields: [{ id: 'answer', label: '答案', type: 'text', required: true }]
    }
    let resumed = false
    const started = runtime.start({ workspaceId: 'w', sessionId: 's', agentId: 'write' }, async (context) => {
      const answer = await context.awaitUser(question)
      resumed = answer.answers.answer === '继续'
    })

    await vi.waitFor(async () => expect((await store.get('run-question'))).toMatchObject({
      status: 'awaiting_user',
      waitingQuestion: question,
      questionId: 'question-runtime',
      currentStage: 'write',
      agentId: 'write'
    }))
    const waiting = await store.get('run-question')
    expect(waiting?.lastSeq).toBe(waiting?.events.at(-1)?.seq)
    expect(waiting?.events.filter((event) => event.event.type === 'agent-question')).toHaveLength(1)
    expect(waiting?.events.filter((event) => event.event.type === 'waiting-user')).toHaveLength(1)

    await Promise.all([
      runtime.answerQuestion({ questionId: question.questionId, answers: { answer: '继续' } }),
      runtime.answerQuestion({ questionId: question.questionId, answers: { answer: '继续' } })
    ])
    await started.done

    const completed = await store.get('run-question')
    expect(resumed).toBe(true)
    expect(completed?.status).toBe('completed')
    expect(completed?.waitingQuestion).toBeUndefined()
    expect(completed?.events.filter((event) => event.event.type === 'run-done')).toHaveLength(1)
    expect(completed?.lastSeq).toBe(completed?.events.at(-1)?.seq)
  })
})
