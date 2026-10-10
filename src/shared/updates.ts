/** Shared by desktop, Android and the Linux service. Only published packages are update candidates. */
export interface UpdatePreferences { automatic: boolean; sources: string[] }
export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  automatic: true,
  sources: ['https://storyfabric.fengyao.xin:10048/download', 'https://github.com/lefengyao/StoryFabric']
}
export type UpdatePlatform = 'windows' | 'android' | 'linux' | 'macos'
export interface UpdateAsset { url: string; fileName: string; bytes: number | null; sha256?: string }
export interface UpdateCheckResult {
  status: 'available' | 'current' | 'empty' | 'unavailable' | 'error'
  currentVersion: string
  platform: UpdatePlatform
  checkedAt: number
  latestVersion?: string
  releaseNotes?: string
  sourceUrl?: string
  asset?: UpdateAsset
  issues: Array<{ source: string; message: string }>
}
export interface UpdateDownloadState {
  status: 'idle' | 'downloading' | 'ready' | 'error'
  receivedBytes: number
  totalBytes: number | null
  version?: string
  error?: string
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function httpsUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim(), base)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}
export function normalizeUpdatePreferences(value: unknown): UpdatePreferences {
  const raw = record(value) ? value : {}
  const sources = Array.isArray(raw.sources) ? [...new Set(raw.sources.map((v) => httpsUrl(v)).filter((v): v is string => !!v))].slice(0, 5) : []
  return { automatic: typeof raw.automatic === 'boolean' ? raw.automatic : true, sources: sources.length ? sources : [...DEFAULT_UPDATE_PREFERENCES.sources] }
}
function parseVersion(value: string): { parts: bigint[]; pre: string[] } | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value.trim())
  if (!match) return null
  const pre = match[4]?.split('.') ?? []
  if (pre.some((p) => /^\d+$/.test(p) && p.length > 1 && p.startsWith('0'))) return null
  return { parts: match.slice(1, 4).map(BigInt), pre }
}
/** SemVer precedence, including prereleases and build metadata; invalid versions are never guessed. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a), right = parseVersion(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++) if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}
interface Release { version: string; notes: string; source: string; assets: UpdateAsset[] }
const stableVersion = (v: unknown): v is string => typeof v === 'string' && !!parseVersion(v) && !parseVersion(v)!.pre.length
function assetOf(rawUrl: unknown, bytes: unknown, hash: unknown, base: string): UpdateAsset | null {
  const url = httpsUrl(rawUrl, base)
  if (!url || (bytes !== null && (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0))) return null
  const sha256 = typeof hash === 'string' ? hash.replace(/^sha256:/, '') : ''
  let fileName: string
  try { fileName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '') } catch { return null }
  return { url, fileName, bytes, ...(/^[a-f\d]{64}$/i.test(sha256) ? { sha256: sha256.toLowerCase() } : {}) }
}
function matchesPlatform(file: string, platform: UpdatePlatform, version: string): boolean {
  const suffix = version.replace(/^v/, '').toLowerCase()
  const name = file.toLowerCase()
  if (platform === 'windows') return name === `storyfabric-setup-${suffix}.exe`
  if (platform === 'android') return name.startsWith('storyfabric-') && name.endsWith(`-${suffix}.apk`) && !name.includes('unsigned')
  if (platform === 'linux') return name === `storyfabric-server-${suffix}.tar.gz`
  return name.startsWith('storyfabric-') && (name.endsWith(`-${suffix}.dmg`) || name.endsWith(`-${suffix}.pkg`))
}
function parseWebsite(raw: unknown, source: string, platform: UpdatePlatform): Release[] {
  if (!record(raw) || raw.catalogFormat !== 2 || !Array.isArray(raw.releases) || (raw.latestId !== null && typeof raw.latestId !== 'string')) throw new Error('版本清单格式不正确')
  if (!raw.releases.length || raw.latestId === null) return []
  const release = raw.releases.find((r) => record(r) && r.id === raw.latestId)
  if (!record(release) || !stableVersion(release.version) || !Array.isArray(release.packages)) throw new Error('版本清单中的当前版本无效')
  const assets: UpdateAsset[] = []
  for (const p of release.packages) {
    if (!record(p) || typeof p.platform !== 'string' || typeof p.channel !== 'string') throw new Error('安装包信息无效')
    const asset = assetOf(p.url, p.bytes, p.sha256, source)
    if (!asset) throw new Error('安装包地址或体积无效')
    if (p.platform === platform && matchesPlatform(asset.fileName, platform, release.version) && (platform !== 'windows' || p.channel === 'installer')) assets.push(asset)
  }
  return [{ version: release.version.replace(/^v/, ''), notes: typeof release.description === 'string' ? release.description : '', source, assets }]
}
function parseGithub(raw: unknown, source: string, platform: UpdatePlatform): Release[] {
  if (!Array.isArray(raw)) throw new Error('GitHub 发行信息格式不正确')
  return raw.filter((r) => record(r) && !r.draft && !r.prerelease && stableVersion(r.tag_name)).map((r) => {
    const rawAssets: unknown[] = Array.isArray(r.assets) ? r.assets : []
    const assets = rawAssets.filter((a): a is Record<string, unknown> => record(a) && a.state === 'uploaded').map((a) => assetOf(a.browser_download_url, a.size, a.digest, source)).filter((a): a is UpdateAsset => !!a && matchesPlatform(a.fileName, platform, r.tag_name))
    return { version: r.tag_name.replace(/^v/, ''), notes: typeof r.body === 'string' ? r.body : '', source, assets }
  }).sort((a, b) => compareVersions(b.version, a.version) ?? 0).slice(0, 1)
}
function endpoint(source: string): { url: string; github: boolean } {
  const u = new URL(source)
  if (u.hostname === 'github.com') {
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2 || !parts.slice(0, 2).every((p) => /^[\w.-]+$/.test(p))) throw new Error('请填写 GitHub 仓库地址')
    return { url: `https://api.github.com/repos/${parts[0]}/${parts[1]}/releases?per_page=100`, github: true }
  }
  u.search = ''; u.hash = ''
  if (!u.pathname.endsWith('.json')) u.pathname = `${u.pathname.replace(/\/?download\/?$/, '').replace(/\/$/, '')}/releases/versions.json`
  return { url: u.href, github: false }
}
export async function checkForUpdates(options: { currentVersion: string; platform: UpdatePlatform; preferences?: UpdatePreferences; fetchImpl?: typeof fetch }): Promise<UpdateCheckResult> {
  const { currentVersion, platform } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const result: UpdateCheckResult = { status: 'error', currentVersion, platform, checkedAt: Date.now(), issues: [] }
  if (!parseVersion(currentVersion)) return { ...result, issues: [{ source: '', message: '当前应用版本号无效' }] }
  let successes = 0
  const catalogs = await Promise.all(normalizeUpdatePreferences(options.preferences).sources.map(async (source) => {
    try {
      const target = endpoint(source)
      const response = await fetchImpl(target.url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (response.status === 404 || response.status === 410) { successes++; return [] }
      if (!response.ok) throw new Error(`更新源返回 HTTP ${response.status}`)
      const releases = target.github ? parseGithub(await response.json(), source, platform) : parseWebsite(await response.json(), source, platform)
      successes++
      return releases
    } catch (error) {
      result.issues.push({ source, message: error instanceof Error && !['TimeoutError', 'AbortError', 'TypeError', 'SyntaxError'].includes(error.name) ? error.message : '无法读取更新源，请稍后重试' })
      return []
    }
  }))
  const releases = catalogs.flat().sort((a, b) => compareVersions(b.version, a.version) ?? 0)
  if (!releases.length) return { ...result, status: successes && !result.issues.length ? 'empty' : 'error' }
  const latest = releases[0]
  Object.assign(result, { latestVersion: latest.version, releaseNotes: latest.notes, sourceUrl: latest.source })
  if ((compareVersions(latest.version, currentVersion) ?? 0) <= 0) return { ...result, status: 'current' }
  let probeErrors = 0, missing = 0
  for (const release of releases.filter((r) => compareVersions(r.version, latest.version) === 0)) {
    for (const asset of release.assets) {
      try {
        const response = await fetchImpl(asset.url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(10_000) })
        const type = response.headers.get('content-type') ?? ''
        const size = response.headers.get('content-length')
        if ([204, 205, 404, 410].includes(response.status) || (response.ok && (/text\/html|application\/json/i.test(type) || size === '0' || (size && asset.bytes !== null && Number(size) !== asset.bytes)))) { missing++; continue }
        if (!response.ok) throw new Error(`安装包检测返回 HTTP ${response.status}`)
        return { ...result, status: 'available', sourceUrl: release.source, releaseNotes: release.notes, asset }
      } catch { probeErrors++; result.issues.push({ source: release.source, message: '无法确认安装包是否可下载，请稍后重试' }) }
    }
  }
  return { ...result, status: probeErrors && !missing ? 'error' : 'unavailable' }
}
