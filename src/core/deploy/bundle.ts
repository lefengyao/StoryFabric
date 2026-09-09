/** 部署包（storyfabric-server-<version>.tar.gz）的清单与命名。 */
export const BUNDLE_ENTRIES = [
  'dist-server/index.mjs',
  'web',
  'Dockerfile.runtime',
  'docker-entrypoint.sh',
  'compose.runtime.yml',
  'VERSION',
  'SHA256SUMS'
] as const

export function bundleFileName(version: string): string {
  return `storyfabric-server-${version}.tar.gz`
}
