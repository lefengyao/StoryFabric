import { describe, expect, it, vi } from 'vitest'
import * as implementation from '../workspaceUpgrade'
import { installPlatformApi } from '../../platform/platformApi'
import { useWorkspace } from '../../stores/workspaceStore'
import type { StoryFabricApi } from '../../../../shared/api'
import type { WorkspaceSummary } from '../../../../shared/types'
const helpers = implementation as unknown as Record<string, (...args: any[]) => any>
const legacyError = () => new Error("Error invoking remote method 'workspace:open': Error: WORKSPACE_UPGRADE_REQUIRED：这是格式 4 的旧项目，需要升级后才能打开。")

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }

describe('explicit legacy workspace upgrade', () => {
  it('recognizes the actual Electron-wrapped error with a Chinese colon', () => {
    expect(implementation.isWorkspaceUpgradeRequired(legacyError())).toBe(true)
    expect(implementation.isWorkspaceUpgradeRequired(new Error('WORKSPACE_UPGRADE_REQUIRED:旧项目格式4需要升级'))).toBe(true)
    expect(implementation.isWorkspaceUpgradeRequired(new Error('NOT_WORKSPACE_UPGRADE_REQUIRED:权限不足'))).toBe(false)
  })
  it('adds approval only on the second call using the same path, signal, and a fresh request ID', async () => {
    expect(helpers.openWorkspaceWithUpgrade).toBeTypeOf('function')
    const controller = new AbortController()
    const initial = { signal: controller.signal, requestId: 'request-original' }
    const open = vi.fn().mockRejectedValueOnce(legacyError()).mockResolvedValueOnce({ name: '旧项目' })
    const answer = deferred<boolean>()
    const confirm = vi.fn(() => answer.promise)
    const opening = helpers.openWorkspaceWithUpgrade('saf:retained-project', open, { options: initial, confirmUpgrade: confirm, createRetryOptions: () => ({ signal: controller.signal, requestId: 'request-upgrade' }) })
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]).toEqual(['saf:retained-project', initial])
    answer.resolve(true)
    await expect(opening).resolves.toEqual({ status: 'opened', value: { name: '旧项目' } })
    expect(open.mock.calls[1]).toEqual(['saf:retained-project', { signal: controller.signal, requestId: 'request-upgrade', upgradeLegacy: true }])
  })

  it('cancellation never writes an upgrade flag or sends a second open request', async () => {
    expect(helpers.openWorkspaceWithUpgrade).toBeTypeOf('function')
    const open = vi.fn().mockRejectedValue(legacyError())
    await expect(helpers.openWorkspaceWithUpgrade('/novel', open, { confirmUpgrade: async () => false })).resolves.toEqual({ status: 'cancelled' })
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][1]?.upgradeLegacy).not.toBe(true)
  })

  it('an older request cannot upgrade when another request becomes current while awaiting approval', async () => {
    expect(helpers.openWorkspaceWithUpgrade).toBeTypeOf('function')
    let request = 1
    const answer = deferred<boolean>()
    const confirm = vi.fn(() => answer.promise)
    const open = vi.fn().mockRejectedValue(legacyError())
    const opening = helpers.openWorkspaceWithUpgrade('/old', open, { isCurrent: () => request === 1, confirmUpgrade: confirm })
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    request = 2
    answer.resolve(true)
    await expect(opening).resolves.toEqual({ status: 'cancelled' })
    expect(open).toHaveBeenCalledOnce()
  })

  it('an aborted request finishes without waiting for a pending confirmation or sending another call', async () => {
    expect(helpers.openWorkspaceWithUpgrade).toBeTypeOf('function')
    const controller = new AbortController()
    const answer = deferred<boolean>()
    const confirm = vi.fn(() => answer.promise)
    const open = vi.fn().mockRejectedValue(legacyError())
    const opening = helpers.openWorkspaceWithUpgrade('/old', open, { options: { signal: controller.signal }, confirmUpgrade: confirm })
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    controller.abort()
    await expect(opening).resolves.toEqual({ status: 'cancelled' })
    answer.resolve(true)
    await Promise.resolve()
    expect(open).toHaveBeenCalledOnce()
  })

  it('forwards ordinary open failures and never asks to upgrade unrelated errors', async () => {
    expect(helpers.openWorkspaceWithUpgrade).toBeTypeOf('function')
    const error = new Error('目录读取权限不足')
    const open = vi.fn().mockRejectedValue(error)
    const confirm = vi.fn()
    await expect(helpers.openWorkspaceWithUpgrade('/novel', open, { confirmUpgrade: confirm })).rejects.toBe(error)
    expect(confirm).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledOnce()
  })
  it('never asks twice when the approved retry still requires an upgrade', async () => {
    const error = legacyError()
    const open = vi.fn().mockRejectedValue(error)
    const confirm = vi.fn(async () => true)
    await expect(implementation.openWorkspaceWithUpgrade('/old', open, { confirmUpgrade: confirm })).rejects.toBe(error)
    expect(open).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenCalledOnce()
    expect(open.mock.calls[1][1]).toMatchObject({ upgradeLegacy: true })
  })
  it('keeps the selected archive bytes, filename, and target across the approved retry', async () => {
    const bytes = new Uint8Array([8, 4])
    const target = { parentDir: 'saf:selected-parent', name: '原选择' }
    const importArchive = vi.fn().mockRejectedValueOnce(legacyError()).mockResolvedValueOnce(undefined)
    await implementation.openWorkspaceWithUpgrade('old.storyfabric.zip', (_fileName, options) => importArchive(bytes, 'old.storyfabric.zip', target, options), { confirmUpgrade: async () => true })
    expect(importArchive).toHaveBeenCalledTimes(2)
    for (const call of importArchive.mock.calls) expect(call.slice(0, 3)).toEqual([bytes, 'old.storyfabric.zip', target])
    expect(importArchive.mock.calls[0][3]?.upgradeLegacy).not.toBe(true)
    expect(importArchive.mock.calls[1][3]).toMatchObject({ upgradeLegacy: true })
  })
  it('cancelling approval retains the active workspace when opening another project', async () => {
    const active: WorkspaceSummary = { path: '/active', name: '当前项目', characters: [], chapters: [], events: [], outline: [], relationships: [] }
    const openWorkspace = vi.fn().mockRejectedValue(legacyError())
    installPlatformApi({ openWorkspace } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'ready', summary: active, uiSource: 'electron-local', error: null })
    try {
      const result = await implementation.openWorkspaceWithUpgrade('/legacy-selected', (path, options) => useWorkspace.getState().open(path, undefined, options), {
        confirmUpgrade: async () => { useWorkspace.setState({ error: null }); return false }
      })
      expect(result).toEqual({ status: 'cancelled' })
      expect(useWorkspace.getState()).toMatchObject({ status: 'ready', summary: active, uiSource: 'electron-local', error: null })
      expect(openWorkspace).toHaveBeenCalledExactlyOnceWith('/legacy-selected')
    } finally { useWorkspace.setState({ status: 'booting', summary: null, uiSource: null, error: null }) }
  })
})
