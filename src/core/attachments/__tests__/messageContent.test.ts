import { describe, expect, it } from 'vitest'
import { toAnthropicMessageContent, toGeminiMessageParts, toOpenAiMessageContent } from '../messageContent'

const image = { kind: 'image' as const, id: 'i1', name: '图.png', mimeType: 'image/png' as const, size: 1, base64: 'AQ==' }
const text = { kind: 'text' as const, id: 't1', name: '计划.md', mimeType: 'text/markdown', size: 4, text: '规划' }
const message = { id: 'u1', role: 'user' as const, text: '描述', files: [image, text] }

describe('message attachment protocol mapping', () => {
  it('maps images and text to OpenAI content blocks', () => {
    expect(toOpenAiMessageContent(message)).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } })
    expect(toOpenAiMessageContent(message)).toContainEqual({ type: 'text', text: expect.stringContaining('计划.md') })
  })

  it('maps images to Anthropic and Gemini native blocks', () => {
    expect(toAnthropicMessageContent(message)).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQ==' } })
    expect(toGeminiMessageParts(message)).toContainEqual({ inlineData: { mimeType: 'image/png', data: 'AQ==' } })
  })
})
