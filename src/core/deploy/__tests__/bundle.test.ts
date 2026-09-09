import { describe, expect, it } from 'vitest'
import { BUNDLE_ENTRIES, bundleFileName } from '../bundle'

describe('部署包清单', () => {
  it('文件名带版本号', () => {
    expect(bundleFileName('0.1.0')).toBe('storyfabric-server-0.1.0.tar.gz')
  })

  it('清单包含服务端、前端与运行时文件', () => {
    expect(BUNDLE_ENTRIES).toEqual([
      'dist-server/index.mjs',
      'web',
      'Dockerfile.runtime',
      'docker-entrypoint.sh',
      'compose.runtime.yml',
      'VERSION',
      'SHA256SUMS'
    ])
  })
})
