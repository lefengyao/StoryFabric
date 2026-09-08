/** Keep third-party packages in independently cacheable chunks. */
const treeShakenPackages = new Set([
  'cookie',
  'detect-node-es',
  'micromark-extension-gfm-tagfilter',
  'micromark-util-encode',
  'react-router-dom',
  'set-cookie-parser',
  'zwitch',
])

export function vendorManualChunks(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/')
  const marker = '/node_modules/'
  const start = normalized.indexOf(marker)
  if (start < 0) return undefined

  const parts = normalized.slice(start + marker.length).split('/')
  const packageName = parts[0]?.startsWith('@') ? `${parts[0]}-${parts[1] ?? 'package'}` : parts[0]
  if (!packageName) return undefined
  if (treeShakenPackages.has(packageName)) return undefined
  return `vendor-${packageName.replaceAll('@', '').replaceAll('/', '-')}`
}
