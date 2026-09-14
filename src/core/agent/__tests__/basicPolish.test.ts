import { expect, it, vi } from 'vitest'
import { applyPolishDecision, runBasicPolish } from '../basicPolish'
import { builtinPackages } from '../../skills/builtin'

it('uses one model call for multiple selected skills and returns a pending diff', async () => {
  const call = vi.fn(async () => ({ text: '改后的正文' }))
  const result = await runBasicPolish({
    workspaceId: 'w', entityId: 'chapter-1', revision: 3, originalText: '原来的正文', intensity: 'standard',
    skills: builtinPackages.slice(0, 3), call
  })
  expect(call).toHaveBeenCalledOnce()
  expect(result).toMatchObject({ status: 'pending', beforeText: '原来的正文', afterText: '改后的正文', baseRevision: 3 })
})

it('keeps the source text when the user rejects the diff', () => {
  expect(applyPolishDecision({ status: 'pending', beforeText: '原文', afterText: '候选', baseRevision: 1 }, false)).toEqual({ status: 'rejected', text: '原文' })
})
