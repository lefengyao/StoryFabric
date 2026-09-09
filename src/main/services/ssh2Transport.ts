/** ssh2 实现的 SshTransport：密码认证、主机指纹校验、SFTP 上传。 */
import { createHash } from 'node:crypto'
import { Client } from 'ssh2'

export interface SshExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface SshConnectConfig {
  host: string
  port: number
  username: string
  password: string
  /** 已 pin 的 sha256 指纹（base64）；缺省表示首次连接 */
  hostKeyFingerprint?: string
}

export interface SshExecOptions {
  /** 写入远程命令的 stdin（`sudo -S` 用它收密码，避免出现在命令行里） */
  stdin?: string
  onData?: (chunk: string) => void
  timeoutMs?: number
}

export interface SshTransport {
  connect(config: SshConnectConfig): Promise<{ fingerprint: string }>
  exec(command: string, options?: SshExecOptions): Promise<SshExecResult>
  upload(localPath: string, remotePath: string): Promise<void>
  dispose(): Promise<void>
}

export function sha256Fingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64')
}

export class Ssh2Transport implements SshTransport {
  private readonly client = new Client()
  private fingerprint = ''
  private pinned: string | undefined

  connect(config: SshConnectConfig): Promise<{ fingerprint: string }> {
    this.pinned = config.hostKeyFingerprint || undefined
    return new Promise((resolve, reject) => {
      this.client.once('ready', () => resolve({ fingerprint: this.fingerprint }))
      this.client.once('error', reject)
      this.client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 15000,
        hostVerifier: (key: Buffer) => {
          this.fingerprint = sha256Fingerprint(key)
          return this.pinned ? this.pinned === this.fingerprint : true
        }
      })
    })
  }

  exec(command: string, options: SshExecOptions = {}): Promise<SshExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        let code = 0
        const timer = options.timeoutMs
          ? setTimeout(() => {
              stream.close()
              reject(new Error(`命令超时：${command}`))
            }, options.timeoutMs)
          : null
        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          stdout += text
          options.onData?.(text)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          stderr += text
          options.onData?.(text)
        })
        stream.on('exit', (exitCode: number | null) => {
          code = exitCode ?? 0
        })
        stream.on('close', () => {
          if (timer) clearTimeout(timer)
          resolve({ code, stdout, stderr })
        })
        if (options.stdin) stream.end(options.stdin)
      })
    })
  }

  upload(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err)
        sftp.fastPut(localPath, remotePath, (putErr) => (putErr ? reject(putErr) : resolve()))
      })
    })
  }

  dispose(): Promise<void> {
    this.client.end()
    return Promise.resolve()
  }
}
