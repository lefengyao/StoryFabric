import type { MessageFile } from '../../shared/types'
import { documentMimeType } from '../inspiration/documentFormats'

export const MAX_IMAGE_BYTES = 100 * 1024 * 1024
export const MAX_TEXT_BYTES = 100 * 1024 * 1024
export const MAX_FILES_PER_MESSAGE = 8
export const MAX_MESSAGE_BYTES = 100 * 1024 * 1024
export const MAX_SESSION_IMAGE_BYTES = 100 * 1024 * 1024

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('附件 base64 编码无效')
  let binary: string
  try { binary = atob(value) } catch { throw new Error('附件 base64 编码无效') }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
}

function isJpeg(bytes: Uint8Array): boolean { return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }
function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
}

function checkImageDimensions(bytes: Uint8Array): void {
  if (!isPng(bytes) || bytes.length < 24) return
  const width = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)
  const height = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('图片尺寸超过限制')
}

function normalizedName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('/') || value.includes('\\') || value.includes('\0')) throw new Error('附件文件名无效')
  return value.trim()
}

export function validateMessageFiles(files: unknown, options: { sessionImageBytes?: number } = {}): MessageFile[] {
  if (!Array.isArray(files)) throw new Error('附件列表无效')
  if (files.length > MAX_FILES_PER_MESSAGE) throw new Error(`每条消息最多添加 ${MAX_FILES_PER_MESSAGE} 个文件`)
  let totalBytes = 0
  let sessionImageBytes = options.sessionImageBytes ?? 0
  const ids = new Set<string>()
  const output: MessageFile[] = []
  for (const raw of files) {
    if (!raw || typeof raw !== 'object') throw new Error('附件格式无效')
    const file = raw as Record<string, unknown>
    const id = typeof file.id === 'string' && file.id.trim() ? file.id.trim() : ''
    if (!id || ids.has(id)) throw new Error('附件 id 无效或重复')
    ids.add(id)
    const name = normalizedName(file.name)
    const kind = file.kind
    if (kind === 'image') {
      const mimeType = file.mimeType
      if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp') throw new Error('图片 MIME 类型不支持')
      const bytes = decodeBase64(file.base64)
      if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('图片大小超过限制')
      const real = mimeType === 'image/png' ? isPng(bytes) : mimeType === 'image/jpeg' ? isJpeg(bytes) : isWebp(bytes)
      if (!real) throw new Error('图片内容与 MIME 类型不匹配')
      checkImageDimensions(bytes)
      totalBytes += bytes.byteLength
      sessionImageBytes += bytes.byteLength
      output.push({ kind: 'image', id, name, mimeType, size: bytes.byteLength, base64: file.base64 as string })
    } else if (kind === 'text') {
      const expectedMime = documentMimeType(name)
      if (!expectedMime || file.mimeType !== expectedMime) throw new Error('文本附件格式不支持')
      if (typeof file.text !== 'string' || file.text.includes('\0') || file.text.includes('\ufffd')) throw new Error('文本附件必须是有效 UTF-8 文本')
      const bytes = new TextEncoder().encode(file.text)
      if (!bytes.byteLength || bytes.byteLength > MAX_TEXT_BYTES) throw new Error('文本附件大小超过限制')
      totalBytes += bytes.byteLength
      output.push({ kind: 'text', id, name, mimeType: expectedMime, size: bytes.byteLength, text: file.text })
    } else {
      throw new Error('附件类型不支持')
    }
    if (totalBytes > MAX_MESSAGE_BYTES) throw new Error('本条消息附件总大小超过限制')
    if (sessionImageBytes > MAX_SESSION_IMAGE_BYTES) throw new Error('本会话图片总大小超过限制')
  }
  return output
}
