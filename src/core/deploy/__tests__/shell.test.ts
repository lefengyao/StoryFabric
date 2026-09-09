import { describe, expect, it } from 'vitest'
import { isSafeImage, isSafeInstallDir, isSafeUsername, shQuote, sudoPrefix } from '../shell'

describe('shQuote', () => {
  it('普通值加单引号', () => {
    expect(shQuote('storyfabric')).toBe("'storyfabric'")
    expect(shQuote('/opt/story fabric')).toBe("'/opt/story fabric'")
  })

  it('单引号被正确转义', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })

  it('命令替换与反引号被中和', () => {
    expect(shQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'")
    expect(shQuote('`whoami`')).toBe("'`whoami`'")
    expect(shQuote('a\nb')).toBe("'a\nb'")
  })

  it('空串返回一对引号', () => {
    expect(shQuote('')).toBe("''")
  })
})

describe('sudoPrefix', () => {
  it('root 不加 sudo，非 root 用 sudo -S（从 stdin 读密码）', () => {
    expect(sudoPrefix(true)).toBe('')
    expect(sudoPrefix(false)).toBe('sudo -S ')
  })
})

describe('输入校验', () => {
  it('用户名只接受常见字符', () => {
    expect(isSafeUsername('root')).toBe(true)
    expect(isSafeUsername('dev.user-1_2')).toBe(true)
    expect(isSafeUsername('a b')).toBe(false)
    expect(isSafeUsername('a;rm -rf /')).toBe(false)
    expect(isSafeUsername('a/b')).toBe(false)
    expect(isSafeUsername('')).toBe(false)
    expect(isSafeUsername('x'.repeat(65))).toBe(false)
  })

  it('安装目录必须是绝对路径且无换行', () => {
    expect(isSafeInstallDir('/opt/storyfabric')).toBe(true)
    expect(isSafeInstallDir('/opt/story fabric')).toBe(true)
    expect(isSafeInstallDir('relative/path')).toBe(false)
    expect(isSafeInstallDir('/opt/a\nb')).toBe(false)
    expect(isSafeInstallDir('')).toBe(false)
  })

  it('基础镜像名接受 registry/repo:tag', () => {
    expect(isSafeImage('node:22-bookworm-slim')).toBe(true)
    expect(isSafeImage('registry.example.com/ns/node:22')).toBe(true)
    expect(isSafeImage('node:22; rm -rf /')).toBe(false)
    expect(isSafeImage('-bad')).toBe(false)
  })
})
