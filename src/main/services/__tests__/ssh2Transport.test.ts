import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Fingerprint } from '../ssh2Transport'

describe('sha256Fingerprint', () => {
  it('返回 base64 编码的 sha256', () => {
    const key = Buffer.from('host-key-bytes')
    expect(sha256Fingerprint(key)).toBe(createHash('sha256').update(key).digest('base64'))
  })

  it('不同主机密钥得到不同指纹', () => {
    expect(sha256Fingerprint(Buffer.from('a'))).not.toBe(sha256Fingerprint(Buffer.from('b')))
  })
})
