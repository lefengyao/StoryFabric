import type { ChatMessage, MessageFile } from '../../shared/types'

export interface AnthropicContentBlock { type: string; text?: string; source?: { type: 'base64'; media_type: string; data: string }; [key: string]: unknown }
export interface GeminiMessagePart { text?: string; inlineData?: { mimeType: string; data: string } }

function textBlock(file: MessageFile): string {
  return file.kind === 'text' ? `资料文件「${file.name}」：\n${file.text}` : ''
}

export function toOpenAiMessageContent(message: ChatMessage): string | Array<Record<string, unknown>> {
  if (!message.files?.length) return message.text ?? ''
  const blocks: Array<Record<string, unknown>> = []
  if (message.text) blocks.push({ type: 'text', text: message.text })
  for (const file of message.files) {
    if (file.kind === 'image') blocks.push({ type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.base64}` } })
    else blocks.push({ type: 'text', text: textBlock(file) })
  }
  return blocks
}

export function toAnthropicMessageContent(message: ChatMessage): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = []
  if (message.text) blocks.push({ type: 'text', text: message.text })
  for (const file of message.files ?? []) {
    if (file.kind === 'image') blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mimeType, data: file.base64 } })
    else blocks.push({ type: 'text', text: textBlock(file) })
  }
  return blocks
}

export function toGeminiMessageParts(message: ChatMessage): GeminiMessagePart[] {
  const parts: GeminiMessagePart[] = []
  if (message.text) parts.push({ text: message.text })
  for (const file of message.files ?? []) {
    if (file.kind === 'image') parts.push({ inlineData: { mimeType: file.mimeType, data: file.base64 } })
    else parts.push({ text: textBlock(file) })
  }
  return parts
}
