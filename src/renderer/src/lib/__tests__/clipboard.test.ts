import { describe, expect, it, vi } from 'vitest'
import { copyPlainText, readPlainText } from '../clipboard'

describe('copyPlainText', () => {
  it('writes the complete text to the clipboard', async () => {
    const writeText = vi.fn(async () => {})

    await copyPlainText('整章正文', { writeText })

    expect(writeText).toHaveBeenCalledWith('整章正文')
  })

  it('reports when clipboard access is unavailable', async () => {
    await expect(copyPlainText('正文', undefined)).rejects.toThrow('当前环境不支持复制到剪贴板')
  })

  it('reads text from an injected clipboard reader', async () => {
    const readText = vi.fn(async () => '剪贴板内容')
    await expect(readPlainText({ readText })).resolves.toBe('剪贴板内容')
    expect(readText).toHaveBeenCalledOnce()
  })
})
