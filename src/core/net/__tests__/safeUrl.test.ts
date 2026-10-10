import { describe, expect, it } from 'vitest'
import { isPrivateIp, validateNetworkUrl } from '../safeUrl'

describe('safe network URLs', () => {
  it('recognizes private, loopback and link-local addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('10.0.0.8')).toBe(true)
    expect(isPrivateIp('192.168.1.20')).toBe(true)
    expect(isPrivateIp('169.254.169.254')).toBe(true)
    expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('fd00::1')).toBe(true)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
  })

  it('rejects non-http protocols, credentials and private hosts when private access is disabled', () => {
    expect(() => validateNetworkUrl('file:///etc/passwd', { allowPrivate: false })).toThrow(/HTTP 或 HTTPS/)
    expect(() => validateNetworkUrl('https://user:pass@example.com', { allowPrivate: false })).toThrow(/用户名或密码/)
    expect(() => validateNetworkUrl('http://127.0.0.1:8787', { allowPrivate: false })).toThrow(/本机或内网/)
    expect(() => validateNetworkUrl('http://metadata.local', { allowPrivate: false })).toThrow(/本机或内网/)
    expect(validateNetworkUrl('https://api.example.com', { allowPrivate: false }).hostname).toBe('api.example.com')
  })

  it('allows explicit local development endpoints', () => {
    expect(validateNetworkUrl('http://127.0.0.1:11434', { allowPrivate: true }).port).toBe('11434')
  })
})
