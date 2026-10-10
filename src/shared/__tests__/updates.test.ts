import { describe, expect, it, vi } from 'vitest'
import { checkForUpdates, compareVersions, DEFAULT_UPDATE_PREFERENCES, normalizeUpdatePreferences } from '../updates'

const website = 'https://storyfabric.fengyao.xin:10048'
const github = 'https://api.github.com/repos/lefengyao/StoryFabric/releases?per_page=100'
const asset = `${website}/releases/0.2.27/StoryFabric-Setup-0.2.27.exe`
function catalog(version = '0.2.27', packages: unknown[] = [{ platform: 'windows', channel: 'installer', url: asset, bytes: 100, sha256: 'a'.repeat(64) }]): unknown {
  return { catalogFormat: 2, latestId: 'latest', releases: [{ id: 'latest', version, channel: 'stable', description: '更新说明', packages }] }
}
function mockFetch(routes: Record<string, unknown | number>): typeof fetch {
  return vi.fn(async (input, init) => {
    const url = String(input)
    const value = routes[url] ?? 404
    if (typeof value === 'number') return new Response(null, { status: value })
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-type': 'application/octet-stream', 'content-length': '100' } })
    return Response.json(value)
  }) as typeof fetch
}
const run = (fetchImpl: typeof fetch, currentVersion = '0.2.26') => checkForUpdates({ currentVersion, platform: 'windows', preferences: DEFAULT_UPDATE_PREFERENCES, fetchImpl })

describe('version comparison', () => {
  it.each([['0.2.10', '0.2.9', 1], ['v1.0.0', '1.0.0+build.2', 0], ['1.0.0', '1.0.0-rc.1', 1], ['1.0.0-rc.10', '1.0.0-rc.2', 1], ['0.2.25', '0.2.26', -1]])('%s vs %s', (a, b, expected) => expect(compareVersions(a, b)).toBe(expected))
  it('rejects malformed versions', () => expect(compareVersions('release-latest', '0.2.26')).toBeNull())
  it('migrates old settings and rejects unsafe sources', () => {
    expect(normalizeUpdatePreferences(undefined)).toEqual(DEFAULT_UPDATE_PREFERENCES)
    expect(normalizeUpdatePreferences({ automatic: false, sources: ['file:///tmp/installer', 'https://example.org/download'] })).toEqual({ automatic: false, sources: ['https://example.org/download'] })
  })
})

describe('update catalog and package availability', () => {
  it('rejects a new release pointing to an installer from an older version', async () => {
    const oldAsset = `${website}/releases/0.2.24/StoryFabric-Setup-0.2.24.exe`
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: catalog('0.2.27', [{ platform: 'windows', channel: 'installer', url: oldAsset, bytes: 100 }]), [github]: [], [oldAsset]: {} }))).toMatchObject({ status: 'unavailable' })
  })
  it.each(['android', 'linux'] as const)('selects only the corresponding %s package', async (platform) => {
    const file = platform === 'android' ? 'StoryFabric-Android-Debug-0.2.27.apk' : 'storyfabric-server-0.2.27.tar.gz'
    const url = `${website}/releases/0.2.27/${file}`
    const fetchImpl = mockFetch({ [`${website}/releases/versions.json`]: catalog('0.2.27', [{ platform, channel: platform === 'android' ? 'package' : 'server', url, bytes: 100 }]), [github]: [], [url]: {} })
    expect(await checkForUpdates({ currentVersion: '0.2.26', platform, fetchImpl })).toMatchObject({ status: 'available', asset: { url } })
  })
  it('reports an unavailable source when the other source is empty', async () => {
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: 503, [github]: [] }))).toMatchObject({ status: 'error' })
  })
  it('rejects zero-byte packages and unsupported catalog formats', async () => {
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: { ...catalog() as object, catalogFormat: 99 }, [github]: [] }))).toMatchObject({ status: 'error' })
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: catalog('0.2.27', [{ platform: 'windows', channel: 'installer', url: asset, bytes: 0 }]), [github]: [] }))).toMatchObject({ status: 'error' })
  })
  it('resolves website packages and verifies they exist', async () => {
    const f = mockFetch({ [`${website}/releases/versions.json`]: catalog(), [github]: [], [asset]: {} })
    expect(await run(f)).toMatchObject({ status: 'available', latestVersion: '0.2.27', asset: { url: asset, sha256: 'a'.repeat(64) } })
    expect(f).toHaveBeenCalledWith(asset, expect.objectContaining({ method: 'HEAD' }))
  })
  it('never offers a downgrade', async () => {
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: catalog('0.2.24'), [github]: [] }))).toMatchObject({ status: 'current' })
  })
  it('treats unpublished sources as empty, without inventing packages', async () => {
    expect(await run(mockFetch({ [github]: [] }))).toMatchObject({ status: 'empty' })
  })
  it('respects an unpublished latestId', async () => {
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: { ...catalog() as object, latestId: null }, [github]: [] }))).toMatchObject({ status: 'empty' })
  })
  it('reports a newer version without this platform package', async () => {
    const result = await run(mockFetch({ [`${website}/releases/versions.json`]: catalog('0.2.27', []), [github]: [] }))
    expect(result).toMatchObject({ status: 'unavailable', latestVersion: '0.2.27' })
    expect(result.asset).toBeUndefined()
  })
  it('reports a catalog package that returns 404', async () => {
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: catalog(), [github]: [] }))).toMatchObject({ status: 'unavailable' })
  })
  it('treats a no-content package response as unavailable', async () => {
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: catalog(), [github]: [], [asset]: 204 }))).toMatchObject({ status: 'unavailable' })
  })
  it('rejects HTML masquerading as a successful file response', async () => {
    const f = mockFetch({ [`${website}/releases/versions.json`]: catalog(), [github]: [] })
    const wrapper: typeof fetch = (url, init) => String(url) === asset ? Promise.resolve(new Response(null, { headers: { 'content-type': 'text/html' } })) : f(url, init)
    expect(await run(wrapper)).toMatchObject({ status: 'unavailable' })
  })
  it('falls back to GitHub when website metadata or files are missing', async () => {
    const ghAsset = 'https://github.com/lefengyao/StoryFabric/releases/download/v0.2.27/StoryFabric-Setup-0.2.27.exe'
    const f = mockFetch({ [`${website}/releases/versions.json`]: catalog(), [github]: [{ tag_name: 'v0.2.27', draft: false, prerelease: false, assets: [{ name: 'StoryFabric-Setup-0.2.27.exe', state: 'uploaded', size: 100, browser_download_url: ghAsset, digest: `sha256:${'b'.repeat(64)}` }] }], [ghAsset]: {} })
    expect(await run(f)).toMatchObject({ status: 'available', asset: { url: ghAsset } })
  })
  it('compares GitHub versions numerically and skips drafts/prereleases', async () => {
    const f = mockFetch({ [github]: [{ tag_name: 'v0.2.9', assets: [] }, { tag_name: 'v0.2.10', assets: [] }, { tag_name: 'v9.0.0', prerelease: true, assets: [] }, { tag_name: 'v8.0.0', draft: true, assets: [] }] })
    expect(await run(f, '0.2.8')).toMatchObject({ status: 'unavailable', latestVersion: '0.2.10' })
  })
  it('distinguishes source failure from an empty release directory', async () => {
    expect(await run(mockFetch({ [`${website}/releases/versions.json`]: 503, [github]: 403 }))).toMatchObject({ status: 'error' })
  })
})
