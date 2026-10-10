import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdatesView } from '../UpdatesView'
import { useAppUpdates } from '../../../stores/appUpdateStore'
import { DEFAULT_UPDATE_PREFERENCES, type UpdateCheckResult } from '../../../../../shared/updates'

vi.mock('../../../platform/platformApi', () => ({ getPlatformApi: () => ({ checkAppUpdate: async () => null, downloadAppUpdate: async () => null }) }))
// Zustand's SSR snapshot is its initial state. Use the current fixture for static state rendering.
vi.mock('../../../stores/appUpdateStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../stores/appUpdateStore')>()
  const hook = Object.assign((selector?: (state: ReturnType<typeof original.useAppUpdates.getState>) => unknown) => selector ? selector(original.useAppUpdates.getState()) : original.useAppUpdates.getState(), original.useAppUpdates)
  return { useAppUpdates: hook }
})
afterEach(() => useAppUpdates.setState({ result: null, download: null }))
const result = (status: UpdateCheckResult['status']): UpdateCheckResult => ({ status, checkedAt: 0, platform: 'windows', currentVersion: '0.2.26', latestVersion: '0.2.27', issues: [] })
describe('update settings states', () => {
  it.each(['empty', 'unavailable', 'error', 'current'] as const)('%s never renders a download or install action', (status) => {
    useAppUpdates.setState({ result: result(status) })
    const html = renderToStaticMarkup(<UpdatesView />)
    expect(html).not.toContain('下载并校验更新')
    expect(html).not.toContain('启动安装程序')
    for (const source of DEFAULT_UPDATE_PREFERENCES.sources) expect(html).toContain(source)
  })
  it('offers a verified Windows package only when an update is available', () => {
    useAppUpdates.setState({ result: { ...result('available'), asset: { url: 'https://example.org/StoryFabric-Setup-0.2.27.exe', fileName: 'StoryFabric-Setup-0.2.27.exe', bytes: 100, sha256: 'a'.repeat(64) } } })
    expect(renderToStaticMarkup(<UpdatesView />)).toContain('下载并校验更新')
  })
  it('offers Android APK without a desktop install action', () => {
    useAppUpdates.setState({ result: { ...result('available'), platform: 'android', asset: { url: 'https://example.org/app.apk', fileName: 'app.apk', bytes: 100 } } })
    const html = renderToStaticMarkup(<UpdatesView />)
    expect(html).toContain('下载Android APK')
    expect(html).not.toContain('启动安装程序')
  })
})
