import { describe, expect, it } from 'vitest'
import { isWorkspaceArchiveFile, readWorkspaceArchiveFile } from '../workspaceArchiveFile'

describe('workspaceArchiveFile', () => {
  it('只接受大小写不敏感的 StoryFabric 工作区压缩包', () => {
    expect(isWorkspaceArchiveFile(new File(['x'], 'demo.storyfabric.zip'))).toBe(true)
    expect(isWorkspaceArchiveFile(new File(['x'], 'DEMO.STORYFABRIC.ZIP'))).toBe(true)
    expect(isWorkspaceArchiveFile(new File(['x'], 'demo.zip'))).toBe(false)
    expect(isWorkspaceArchiveFile(new File(['x'], 'demo.txt'))).toBe(false)
  })

  it('读取压缩包字节', async () => {
    await expect(readWorkspaceArchiveFile(new File(['abc'], 'demo.storyfabric.zip'))).resolves.toEqual(new Uint8Array([97, 98, 99]))
  })

  it('拒绝非工作区压缩包并提示正确错误', async () => {
    await expect(readWorkspaceArchiveFile(new File(['abc'], 'demo.zip'))).rejects.toThrow('请选择 .storyfabric.zip 工作区压缩包')
  })
})
