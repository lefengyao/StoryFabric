import { describe, expect, it } from 'vitest'
import { validateMessageFiles } from '../validation'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('validateMessageFiles', () => {
  it('accepts a real PNG and UTF-8 text file', () => {
    expect(validateMessageFiles([
      { kind: 'image', id: 'i1', name: '封面.png', mimeType: 'image/png', size: 68, base64: png },
      { kind: 'text', id: 't1', name: '计划.md', mimeType: 'text/markdown', size: 6, text: '你好\n' }
    ])).toMatchObject([
      { kind: 'image', name: '封面.png', mimeType: 'image/png' },
      { kind: 'text', name: '计划.md', text: '你好\n' }
    ])
  })

  it('rejects a fake image MIME or malformed base64', () => {
    expect(() => validateMessageFiles([{ kind: 'image', id: 'i1', name: 'x.jpg', mimeType: 'image/jpeg', size: 68, base64: png }])).toThrow(/图片|格式|MIME/)
    expect(() => validateMessageFiles([{ kind: 'image', id: 'i1', name: 'x.png', mimeType: 'image/png', size: 1, base64: 'not base64!' }])).toThrow(/编码|base64|无效/)
  })

  it('rejects NUL-containing and invalid UTF-8 text', () => {
    expect(() => validateMessageFiles([{ kind: 'text', id: 't1', name: 'x.txt', mimeType: 'text/plain', size: 1, text: 'a\0b' }])).toThrow(/文本|NUL/)
    expect(() => validateMessageFiles([{ kind: 'text', id: 't1', name: 'x.txt', mimeType: 'text/plain', size: 1, text: '\ufffd' }])).toThrow(/UTF-8|文本/)
  })
})
