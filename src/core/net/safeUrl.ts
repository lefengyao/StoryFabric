export interface NetworkUrlOptions {
  /** Desktop users may intentionally point at a local Ollama or proxy endpoint. */
  allowPrivate?: boolean
  /** Resolve hostnames before allowing a server-side request. */
  resolveHostname?: boolean
}

function normalizedHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
}

function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  if (octets.some((part) => part > 255)) return null
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0
}

function ipv6ToBigInt(value: string): bigint | null {
  const normalized = value.toLowerCase().split('%', 1)[0]
  const mapped = normalized.match(/^(?:0*:){0,5}ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) {
    const v4 = ipv4ToNumber(mapped[1])
    return v4 === null ? null : (BigInt(0xffff) << 32n) | BigInt(v4)
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  return parts.reduce((result, part) => (result << 16n) | BigInt(parseInt(part, 16)), 0n)
}

function ipVersion(value: string): 0 | 4 | 6 {
  if (ipv4ToNumber(value) !== null) return 4
  if (value.includes(':') && ipv6ToBigInt(value) !== null) return 6
  return 0
}

/** Covers loopback, link-local, private, benchmark, documentation and multicast ranges. */
export function isPrivateIp(value: string): boolean {
  const hostname = normalizedHostname(value)
  const version = ipVersion(hostname)
  if (version === 4) {
    const numeric = ipv4ToNumber(hostname)
    if (numeric === null) return true
    const inRange = (start: number, end: number): boolean => numeric >= start && numeric <= end
    return inRange(0x00000000, 0x00ffffff) // 0.0.0.0/8
      || inRange(0x0a000000, 0x0affffff) // 10.0.0.0/8
      || inRange(0x64400000, 0x647fffff) // 100.64.0.0/10
      || inRange(0x7f000000, 0x7fffffff) // 127.0.0.0/8
      || inRange(0xa9fe0000, 0xa9feffff) // 169.254.0.0/16
      || inRange(0xac100000, 0xac1fffff) // 172.16.0.0/12
      || inRange(0xc0000000, 0xc00000ff) // 192.0.0.0/24
      || inRange(0xc0000200, 0xc00002ff) // 192.0.2.0/24
      || inRange(0xc0a80000, 0xc0a8ffff) // 192.168.0.0/16
      || inRange(0xc6120000, 0xc613ffff) // 198.18.0.0/15
      || inRange(0xc6336400, 0xc63364ff) // 198.51.100.0/24
      || inRange(0xcb007100, 0xcb0071ff) // 203.0.113.0/24
      || inRange(0xe0000000, 0xffffffff) // multicast/reserved
  }
  if (version === 6) {
    const numeric = ipv6ToBigInt(hostname)
    if (numeric === null) return true
    const range = (prefix: number | bigint, bits: number): boolean => numeric >> BigInt(128 - bits) === BigInt(prefix)
    return numeric === 0n
      || numeric === 1n
      || range(0x7e, 7) // fc00::/7
      || range(0x3fa, 10) // fe80::/10
      || range(0xff, 8) // ff00::/8
      || range(0x20010db8, 32) // 2001:db8::/32
      || (numeric >> 32n) === 0xffffn // IPv4-mapped addresses
  }
  return false
}

export function validateNetworkUrl(input: string, options: NetworkUrlOptions = {}): URL {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new Error('网络地址无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('网络地址只允许 HTTP 或 HTTPS')
  if (url.username || url.password) throw new Error('网络地址不允许包含用户名或密码')
  if (!options.allowPrivate) {
    const hostname = normalizedHostname(url.hostname)
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) {
      throw new Error('出于安全原因，服务端不允许访问本机或内网地址')
    }
  }
  return url
}

export async function assertSafeNetworkUrl(input: string, options: NetworkUrlOptions = {}): Promise<URL> {
  const url = validateNetworkUrl(input, options)
  // DNS resolution is only available in Node. Browser/Android callers still
  // get literal-address validation without pulling Node built-ins into the
  // renderer bundle.
  if (options.allowPrivate || options.resolveHostname === false || typeof process === 'undefined' || !process.versions?.node) return url
  try {
    const { promises: dns } = await import('node:dns')
    const records = await dns.lookup(url.hostname, { all: true, verbatim: true })
    if (records.some((record) => isPrivateIp(record.address))) throw new Error('出于安全原因，服务端不允许访问本机或内网地址')
  } catch (error) {
    if (error instanceof Error && error.message.includes('不允许访问本机或内网')) throw error
    // DNS failures are left to fetch so users receive the provider's normal error.
  }
  return url
}
