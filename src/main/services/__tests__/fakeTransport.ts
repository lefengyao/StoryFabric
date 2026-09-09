import type { SshConnectConfig, SshExecOptions, SshExecResult, SshTransport } from '../ssh2Transport'

export interface FakeRule {
  /** 命令包含该子串即命中 */
  match: string
  result: SshExecResult
}

/** 测试用传输层：按规则返回预设输出，并记录调用序列。 */
export class FakeTransport implements SshTransport {
  readonly calls: string[] = []
  readonly uploads: Array<{ local: string; remote: string }> = []

  constructor(
    private readonly rules: FakeRule[],
    private readonly fingerprint = 'fp-sha256-test'
  ) {}

  async connect(config: SshConnectConfig): Promise<{ fingerprint: string }> {
    this.calls.push(`connect ${config.host}:${config.port}`)
    if (config.hostKeyFingerprint && config.hostKeyFingerprint !== this.fingerprint) {
      throw new Error('主机指纹不匹配')
    }
    return { fingerprint: this.fingerprint }
  }

  async exec(command: string, options: SshExecOptions = {}): Promise<SshExecResult> {
    this.calls.push(command)
    const rule = this.rules.find((r) => command.includes(r.match))
    const result = rule?.result ?? { code: 0, stdout: '', stderr: '' }
    if (result.stdout) options.onData?.(result.stdout)
    if (result.stderr) options.onData?.(result.stderr)
    return result
  }

  async upload(local: string, remote: string): Promise<void> {
    this.calls.push(`upload ${remote}`)
    this.uploads.push({ local, remote })
  }

  async dispose(): Promise<void> {
    this.calls.push('dispose')
  }
}
