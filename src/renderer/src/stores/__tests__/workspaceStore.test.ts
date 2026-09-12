import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoryFabricApi } from '../../../../shared/api'
import type { WorkspaceSummary } from '../../../../shared/types'
import { installPlatformApi } from '../../platform/platformApi'
import { useWorkspace } from '../workspaceStore'

const summary: WorkspaceSummary = { name: '导入工作区', path: 'workspace/imported', characters: [], relationships: [], outline: [], events: [], chapters: [] }

afterEach(() => {
  useWorkspace.setState({ status: 'booting', summary: null, error: null })
})

describe('workspace store archive imports', () => {
  it('passes cancellation to an open request so a closed picker cannot commit the platform side effect', async () => {
    const controller = new AbortController()
    let finalSideEffect = false
    const openWorkspace = vi.fn(async (_path: string, options?: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        if (options?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
        else setTimeout(resolve, 0)
      })
      finalSideEffect = true
      return summary
    })
    installPlatformApi({ openWorkspace } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'empty', summary: null, error: null })

    const opening = useWorkspace.getState().open('workspace/closed', undefined, { signal: controller.signal })
    controller.abort()
    await expect(opening).rejects.toThrow('aborted')

    expect(openWorkspace).toHaveBeenCalledWith('workspace/closed', { signal: controller.signal })
    expect(finalSideEffect).toBe(false)
    expect(useWorkspace.getState()).toMatchObject({ status: 'empty', summary: null })
  })

  it('passes cancellation to an import request so a closed picker cannot commit the platform side effect', async () => {
    const controller = new AbortController()
    let finalSideEffect = false
    const importWorkspace = vi.fn(async (_bytes: Uint8Array, _fileName: string, _target?: unknown, options?: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        if (options?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
        else setTimeout(resolve, 0)
      })
      finalSideEffect = true
      return summary
    })
    installPlatformApi({ importWorkspace } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'empty', summary: null, error: null })

    const importing = useWorkspace.getState().importArchive(new Uint8Array([1]), 'closed.storyfabric.zip', undefined, undefined, { signal: controller.signal })
    controller.abort()
    await expect(importing).rejects.toThrow('aborted')

    expect(importWorkspace).toHaveBeenCalledWith(new Uint8Array([1]), 'closed.storyfabric.zip', undefined, { signal: controller.signal })
    expect(finalSideEffect).toBe(false)
    expect(useWorkspace.getState()).toMatchObject({ status: 'empty', summary: null })
  })

  it('does not update global state when the import generation is stale', async () => {
    let resolveImport: ((value: WorkspaceSummary) => void) | undefined
    const importWorkspace = vi.fn(() => new Promise<WorkspaceSummary>((resolve) => { resolveImport = resolve }))
    installPlatformApi({ importWorkspace } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'empty', summary: null, error: null })

    let current = true
    const importing = useWorkspace.getState().importArchive(new Uint8Array([1]), 'demo.storyfabric.zip', undefined, () => current)
    current = false
    resolveImport?.(summary)
    await importing

    expect(importWorkspace).toHaveBeenCalledOnce()
    expect(useWorkspace.getState()).toMatchObject({ status: 'empty', summary: null, error: null })
  })

  it('does not commit a stale open result to the workspace store', async () => {
    let resolveOpen: ((value: WorkspaceSummary) => void) | undefined
    const openWorkspace = vi.fn(() => new Promise<WorkspaceSummary>((resolve) => { resolveOpen = resolve }))
    installPlatformApi({ openWorkspace } as unknown as StoryFabricApi)
    useWorkspace.setState({ status: 'empty', summary: null, error: null })

    let current = true
    const opening = useWorkspace.getState().open('workspace/old', () => current)
    current = false
    resolveOpen?.(summary)
    await opening

    expect(openWorkspace).toHaveBeenCalledWith('workspace/old')
    expect(useWorkspace.getState()).toMatchObject({ status: 'empty', summary: null, error: null })
  })
})
