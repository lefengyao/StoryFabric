import { describe, expect, it, vi } from 'vitest'
import { copyPlainText } from '../clipboard'

describe('copyPlainText', () => {
  it('writes the complete text to the clipboard', async () => {
    const writeText = vi.fn(async () => {})

    await copyPlainText('整章正文', { writeText })

    expect(writeText).toHaveBeenCalledWith('整章正文')
  })

  it('reports when clipboard access is unavailable', async () => {
    await expect(copyPlainText('正文', undefined)).rejects.toThrow('当前环境不支持复制到剪贴板')
  })
})
