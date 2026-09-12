import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeWorkspace } from '../../../core/workspace/workspaceService'
import { NodeFileStore } from '../../../core/storage/nodeFileStore'
import { listWorkspaces } from '../workspaceService'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Electron local workspace listing', () => {
  it('enumerates every valid workspace below the documents root, not only recent settings', async () => {
    const documents = await mkdtemp(join(process.env.TEMP ?? process.cwd(), 'storyfabric-list-'))
    roots.push(documents)
    await mkdir(join(documents, 'nested'), { recursive: true })
    await initializeWorkspace(new NodeFileStore(join(documents, 'first')), '第一个')
    await initializeWorkspace(new NodeFileStore(join(documents, 'nested', 'second')), '第二个')
    await mkdir(join(documents, 'not-a-workspace'))

    const result = await listWorkspaces(documents)

    const paths = result.map((item) => item.path).sort()
    expect(paths).toEqual([
      join(documents, 'first'),
      join(documents, 'nested', 'second')
    ].sort())
  })
})
