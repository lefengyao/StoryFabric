import { describe, expect, it } from 'vitest'
import { prepareMessageFiles } from '../prepareMessageFiles'

describe('prepareMessageFiles', () => {
  it('prepares image and text files with normalized payloads', async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], '封面.png', { type: 'image/png' })
    const text = new File(['计划内容'], '计划.md', { type: 'text/markdown' })
    const files = await prepareMessageFiles([image, text])
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ kind: 'image', name: '封面.png', mimeType: 'image/png', size: 8 })
    expect(files[1]).toMatchObject({ kind: 'text', name: '计划.md', mimeType: 'text/markdown', text: '计划内容' })
  })
})
