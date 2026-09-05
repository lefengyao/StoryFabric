import type { ChatSession } from '../../shared/types'

export interface SessionArchive {
  fileName: string
  base64: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function exportSessionArchive(session: ChatSession): SessionArchive {
  const payload = JSON.stringify(session, null, 2)
  return {
    fileName: `${(session.title || '新会话').replace(/[\\/:*?"<>|]/g, '').trim() || 'session'}.storyfabric.session.json`,
    base64: bytesToBase64(new TextEncoder().encode(payload))
  }
}

export function decodeSessionArchive(base64: string): ChatSession {
  const text = new TextDecoder().decode(base64ToBytes(base64))
  const value = JSON.parse(text) as Partial<ChatSession>
  if (!value || typeof value !== 'object' || !Array.isArray(value.messages)) throw new Error('文件不是有效的 StoryFabric 会话')
  if (typeof value.title !== 'string' || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') {
    throw new Error('会话文件缺少必要字段')
  }
  return {
    id: typeof value.id === 'string' ? value.id : '',
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    archived: Boolean(value.archived),
    messages: value.messages
  } as ChatSession
}
