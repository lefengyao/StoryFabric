import type { MessageFile } from '../../../shared/types'
import { bytesToBase64 } from '../platform/archiveTransfer'

const TEXT_TYPES: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json' }
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export async function prepareMessageFiles(files: File[]): Promise<MessageFile[]> {
  const result: MessageFile[] = []
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const ext = extension(file.name)
    const imageType = IMAGE_TYPES.has(file.type) ? file.type as 'image/png' | 'image/jpeg' | 'image/webp' : undefined
    const textType = TEXT_TYPES[ext]
    if (imageType) {
      result.push({ kind: 'image', id: makeId(), name: file.name, mimeType: imageType, size: bytes.byteLength, base64: bytesToBase64(bytes) })
    } else if (textType) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      result.push({ kind: 'text', id: makeId(), name: file.name, mimeType: textType, size: bytes.byteLength, text })
    } else {
      throw new Error(`不支持的附件类型：${file.name}`)
    }
  }
  return result
}
