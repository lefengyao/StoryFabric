import { describe, expect, it } from 'vitest'
import { shouldSendOnKey } from '../sendShortcut'

const key = (patch: Partial<Parameters<typeof shouldSendOnKey>[1]> = {}): Parameters<typeof shouldSendOnKey>[1] => ({
  key: 'Enter',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  ...patch
})

describe('shouldSendOnKey', () => {
  it('Enter 发送模式：裸 Enter 发送，Shift+Enter 换行', () => {
    expect(shouldSendOnKey('enter', key())).toBe(true)
    expect(shouldSendOnKey('enter', key({ shiftKey: true }))).toBe(false)
  })

  it('Ctrl/⌘+Enter 模式：必须带修饰键', () => {
    expect(shouldSendOnKey('mod+enter', key())).toBe(false)
    expect(shouldSendOnKey('mod+enter', key({ ctrlKey: true }))).toBe(true)
    expect(shouldSendOnKey('mod+enter', key({ metaKey: true }))).toBe(true)
    expect(shouldSendOnKey('mod+enter', key({ ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('输入法组合中与非 Enter 键都不发送', () => {
    expect(shouldSendOnKey('enter', key({ isComposing: true }))).toBe(false)
    expect(shouldSendOnKey('enter', key({ key: 'a' }))).toBe(false)
  })
})
