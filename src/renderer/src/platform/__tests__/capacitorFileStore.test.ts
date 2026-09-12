import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mkdir, stat } = vi.hoisted(() => ({ mkdir: vi.fn(), stat: vi.fn() }))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { mkdir, stat }
}))

import { CapacitorFileStore } from '../capacitorFileStore'

describe('CapacitorFileStore', () => {
  beforeEach(() => {
    mkdir.mockReset()
    stat.mockReset()
  })

  it('treats an existing directory as success for recursive creation', async () => {
    mkdir.mockRejectedValueOnce(new Error('Directory already exists'))
    stat.mockResolvedValueOnce({ type: 'directory' })

    await expect(new CapacitorFileStore('workspaces/demo').ensureDir('chapters')).resolves.toBeUndefined()
    expect(stat).toHaveBeenCalledWith({ path: 'workspaces/demo/chapters', directory: 'DATA' })
  })
})
