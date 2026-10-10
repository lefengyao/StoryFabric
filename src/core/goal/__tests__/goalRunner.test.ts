import { describe, expect, it } from 'vitest'
import type { GoalRun, GoalTask } from '../../../shared/types'
import { GoalRunner } from '../goalRunner'

const task = (id: string, dependsOn: string[] = []): GoalTask => ({
  id,
  title: id,
  instructions: `执行 ${id}`,
  acceptanceCriteria: [`${id} 已完成`],
  dependsOn,
  status: 'pending',
  attempts: 0
})

const goal = (): GoalRun => ({
  id: 'goal-1', workspaceId: 'w', sessionId: 's', goal: '完成目标', status: 'planning', planVersion: 1,
  tasks: [], approvalPolicy: 'strict', createdAt: 1, updatedAt: 1
})

describe('GoalRunner', () => {
  it('persists planning, task progress, validation, and completion snapshots', async () => {
    const saved: GoalRun[] = []
    const runner = new GoalRunner({
      plan: async () => [task('research'), task('draft', ['research'])],
      execute: async (_goal, current) => ({ summary: `${current.id} result` }),
      validate: async (_goal, current) => ({ passed: true, reason: `${current.id} verified` }),
      save: async (snapshot) => { saved.push(structuredClone(snapshot)) },
      emit: () => undefined
    })
    const result = await runner.start(goal())
    expect(result.status).toBe('completed')
    expect(result.tasks.map((item) => item.status)).toEqual(['completed', 'completed'])
    expect(saved.some((snapshot) => snapshot.status === 'validating')).toBe(true)
  })

  it('retries a failed validation once and then enters needs-attention', async () => {
    let calls = 0
    const runner = new GoalRunner({
      plan: async () => [task('write')],
      execute: async () => ({ summary: 'draft' }),
      validate: async () => ({ passed: ++calls > 2, reason: '事实不足' }),
      save: async () => undefined,
      emit: () => undefined
    })
    const result = await runner.start(goal())
    expect(result.status).toBe('needs-attention')
    expect(calls).toBe(2)
  })

  it('stops and resumes only unfinished tasks', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const runner = new GoalRunner({
      plan: async () => [task('first'), task('second', ['first'])],
      execute: async (_goal, current, signal) => {
        if (current.id === 'first') {
          await blocked
          if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
        }
        return { summary: current.id }
      },
      validate: async () => ({ passed: true, reason: 'ok' }),
      save: async () => undefined,
      emit: () => undefined
    })
    const current = goal()
    const running = runner.start(current)
    await Promise.resolve()
    await runner.stop()
    release()
    const stopped = await running
    expect(stopped.status).toBe('cancelled')
    expect(stopped.tasks[0].status).toBe('pending')

    const resumed = await runner.resume({ ...stopped, status: 'cancelled' })
    expect(resumed.status).toBe('completed')
  })

  it('can resume a persisted goal that was waiting for approval', async () => {
    const persisted: GoalRun = {
      ...goal(),
      status: 'awaiting-approval',
      tasks: [{ ...task('write'), status: 'awaiting-approval', attempts: 1 }]
    }
    const runner = new GoalRunner({
      plan: async () => [],
      execute: async () => ({ summary: '写入完成' }),
      validate: async () => ({ passed: true, reason: 'ok' }),
      save: async () => undefined,
      emit: () => undefined
    })
    await expect(runner.resume(persisted)).resolves.toMatchObject({ status: 'completed' })
  })
})
