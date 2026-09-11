import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const sshState = vi.hoisted(() => {
  const sftp = {
    fastPut: vi.fn((_local: string, _remote: string, callback: (error?: Error) => void) => callback()),
    end: vi.fn()
  }
  const client = {
    sftp: vi.fn((callback: (error: Error | undefined, value: typeof sftp) => void) => callback(undefined, sftp)),
    end: vi.fn()
  }
  return { sftp, client }
})

vi.mock('ssh2', () => ({
  Client: class {
    constructor() {
      return sshState.client
    }
  }
}))

import { sha256Fingerprint, Ssh2Transport } from '../ssh2Transport'

describe('sha256Fingerprint', () => {
  it('返回 base64 编码的 sha256', () => {
    const key = Buffer.from('host-key-bytes')
    expect(sha256Fingerprint(key)).toBe(createHash('sha256').update(key).digest('base64'))
  })

  it('不同主机密钥得到不同指纹', () => {
    expect(sha256Fingerprint(Buffer.from('a'))).not.toBe(sha256Fingerprint(Buffer.from('b')))
  })

  it('上传完成后关闭 SFTP 通道，避免占用 SSH session', async () => {
    const transport = new Ssh2Transport()

    await transport.upload('bundle.tar.gz', '/tmp/bundle.tar.gz')

    expect(sshState.sftp.end).toHaveBeenCalledOnce()
  })
})
