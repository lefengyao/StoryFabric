import { describe, expect, it } from 'vitest'
import { serializeWorkspace, workspaceStore } from '../workspaceRuntime'

describe('desktop workspace runtime', () => {
  it('serializes writes per workspace and reuses one FileStore instance', async () => {
    const root = `runtime-test-${Date.now()}-${Math.random()}`
    const order: string[] = []
    await Promise.all([
      serializeWorkspace(root, async () => { order.push('first-start'); await new Promise((resolve) => setTimeout(resolve, 10)); order.push('first-end') }),
      serializeWorkspace(root, async () => { order.push('second-start'); order.push('second-end') })
    ])

    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
    expect(workspaceStore(root)).toBe(workspaceStore(root))
  })
})
