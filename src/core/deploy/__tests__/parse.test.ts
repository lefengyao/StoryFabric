import { describe, expect, it } from 'vitest'
import { parseContainerImage, parseDockerVersion, parseOs, parseOsRelease, parsePasswordlessSudo, parsePortInUse } from '../parse'

describe('parseOs', () => {
  it('Linux 通过，其它拒绝', () => {
    expect(parseOs('Linux\n')).toBe('linux')
    expect(parseOs('Darwin')).toBe('unsupported')
    expect(parseOs('MINGW64_NT-10.0')).toBe('unsupported')
  })
})

describe('parseDockerVersion', () => {
  it('取出版本号，缺失返回 undefined', () => {
    expect(parseDockerVersion('27.1.1\n')).toBe('27.1.1')
    expect(parseDockerVersion('')).toBeUndefined()
    expect(parseDockerVersion('docker: command not found')).toBeUndefined()
  })
})

describe('parsePortInUse', () => {
  it('ss 输出含 LISTEN 视为占用', () => {
    expect(parsePortInUse('State Recv-Q Send-Q Local Address:Port\nLISTEN 0 128 0.0.0.0:8787 0.0.0.0:*')).toBe(true)
    expect(parsePortInUse('State Recv-Q Send-Q Local Address:Port')).toBe(false)
  })
})

describe('parsePasswordlessSudo', () => {
  it('退出码 0 表示免密 sudo 可用', () => {
    expect(parsePasswordlessSudo(0)).toBe(true)
    expect(parsePasswordlessSudo(1)).toBe(false)
  })
})

describe('parseOsRelease', () => {
  it('解析 ID 与 PRETTY_NAME', () => {
    const text = 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n'
    expect(parseOsRelease(text)).toEqual({ id: 'ubuntu', prettyName: 'Ubuntu 24.04.1 LTS' })
  })
})

describe('parseContainerImage', () => {
  it('从 inspect 输出取镜像 tag', () => {
    expect(parseContainerImage('storyfabric:0.1.0\n')).toBe('storyfabric:0.1.0')
    expect(parseContainerImage('Error: No such object')).toBeUndefined()
  })
})
