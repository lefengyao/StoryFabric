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
})
