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

  it('直接打开工作区时也拒绝绕过规范化的旧路径', async () => {
    const api = Object.create(AndroidPlatformApi.prototype) as AndroidPlatformApi
    await expect(api.openWorkspace('workspaces/../legacy')).rejects.toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })

  it('从 lastWorkspacePath 恢复时拒绝旧路径', async () => {
    const api = Object.create(AndroidPlatformApi.prototype) as AndroidPlatformApi
    Object.assign(api as unknown as Record<string, unknown>, {
      currentPath: null,
      currentStore: null,
      settings: { lastWorkspacePath: 'workspaces/../legacy' },
      loadSettings: async () => ({ lastWorkspacePath: 'workspaces/../legacy' })
    })
    await expect(api.getCurrentWorkspace()).rejects.toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })
})
