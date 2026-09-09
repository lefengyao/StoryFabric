import { describe, expect, it } from 'vitest'
import { BUNDLE_ENTRIES } from '../bundle'

describe('部署包清单', () => {
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
