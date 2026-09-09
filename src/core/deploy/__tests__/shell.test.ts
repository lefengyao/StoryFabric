import { describe, expect, it } from 'vitest'
import { shQuote, sudoPrefix } from '../shell'

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
