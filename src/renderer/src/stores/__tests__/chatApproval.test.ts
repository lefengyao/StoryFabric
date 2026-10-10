import { afterEach, expect, it, vi } from 'vitest'
import { useChat } from '../chatStore'
import { installPlatformApi } from '../../platform/platformApi'
import type { StoryFabricApi } from '../../../../shared/api'
import type { PendingChange } from '../../../../shared/types'

afterEach(() => useChat.getState().resetWorkspace())
const change = { id: 'change', title: 'diff', beforeText: 'old', afterText: 'new' } as PendingChange
it('keeps a failed confirmation available for retry', async () => {
  installPlatformApi({ agentConfirm: vi.fn(async () => { throw new Error('offline') }) } as unknown as StoryFabricApi)
  useChat.setState({ activeId: 's', pendingChange: change })
  await expect(useChat.getState().confirmChange(true)).rejects.toThrow('offline')
  expect(useChat.getState().pendingChange).toEqual(change)
})
it('does not clear the newly selected session while confirming an older one', async () => {
  let resolve!: () => void
  installPlatformApi({ agentConfirm: vi.fn(() => new Promise<void>((ok) => { resolve = ok })) } as unknown as StoryFabricApi)
  useChat.setState({ activeId: 's', pendingChange: change })
  const pending = useChat.getState().confirmChange(true)
  useChat.setState({ activeId: 'other', pendingChange: { ...change, id: 'other-change' } })
  resolve(); await pending
  expect(useChat.getState().pendingChange?.id).toBe('other-change')
})
it('keeps a history-eligible approval pending until the user chooses save or skip', async () => {
  const agentConfirm = vi.fn(async () => {})
  installPlatformApi({ agentConfirm } as unknown as StoryFabricApi)
  useChat.setState({ activeId: 's', pendingChange: { ...change, historyEligible: true } })
  await expect(useChat.getState().confirmChange(true)).rejects.toThrow(/版本|选择/)
  expect(agentConfirm).not.toHaveBeenCalled()
  expect(useChat.getState().pendingChange?.id).toBe('change')
  await useChat.getState().confirmChange(true, { saveHistory: false })
  expect(agentConfirm).toHaveBeenCalledWith('s', 'change', true, { saveHistory: false })
})
