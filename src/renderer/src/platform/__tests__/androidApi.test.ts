import { describe, expect, it } from 'vitest'
import { AndroidPlatformApi, normalizeAndroidWorkspacePath } from '../androidApi'

describe('normalizeAndroidWorkspacePath', () => {
  it('接受 workspaces/<name> 并去除首尾空白', () => {
    expect(normalizeAndroidWorkspacePath('  workspaces/demo  ')).toBe('workspaces/demo')
  })

  it.each([
    '/data/user/0/app/workspaces/demo',
    'workspaces/..',
    'workspaces/demo/chapters',
    'workspaces\\demo'
  ])('拒绝非法路径 %s', (path) => {
    expect(() => normalizeAndroidWorkspacePath(path)).toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })

  it('通过 API 以 rejected Promise 返回非法路径', async () => {
    const api = Object.create(AndroidPlatformApi.prototype) as AndroidPlatformApi
    await expect(api.openWorkspaceByPath('workspaces/..')).rejects.toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })
})
