import type { WriteRevision } from '../../shared/documentHistory'
import { parseFrontMatter, stringifyFrontMatter } from './frontMatter'

export function newWriteRevision(): WriteRevision {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `wr_${random}` as WriteRevision
}

export function isWriteRevision(value: unknown): value is WriteRevision {
  return typeof value === 'string' && /^wr_[a-zA-Z0-9_-]+$/.test(value)
}

function embeddedDocumentRevision(content: string): WriteRevision | undefined {
  try {
    const data = content.trimStart().startsWith('{') ? JSON.parse(content) : parseFrontMatter(content).data
    if (typeof data.id === 'string' && isWriteRevision(data.writeRevision)
      && ('status' in data || 'box' in data || 'kind' in data || ('order' in data && 'content' in data))) return data.writeRevision
  } catch { /* Generic resources retain their hash baseline. */ }
  return undefined
}

/** Rotate only the current document revision; historical snapshots never use this helper. */
export function rotateDocumentRevision(raw: string): string {
  const writeRevision = newWriteRevision()
  const updatedAt = new Date().toISOString()
  if (raw.trimStart().startsWith('{')) {
    const document = JSON.parse(raw) as Record<string, unknown>
    return JSON.stringify({ ...document, writeRevision, updatedAt }, null, 2)
  }
  const parsed = parseFrontMatter(raw)
  const eol = raw.match(/^(?:\uFEFF)?---[^\r\n]*(\r?\n)/)?.[1] ?? '\n'
  const header = stringifyFrontMatter('', { ...parsed.data, writeRevision, updatedAt }).slice(0, -1).replace(/\n/g, eol)
  return `${raw.startsWith('\uFEFF') ? '\uFEFF' : ''}${header}${parsed.content}`
}

/** Stable, platform-independent content revision for tool baselines and search cursors. */
export function resourceRevision(...parts: Array<string | number | boolean | null | undefined>): string {
  const input = parts.map((part) => part === undefined || part === null ? '' : String(part)).join('\u001f')
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `r1-${(hash >>> 0).toString(36)}-${input.length.toString(36)}`
}

export function contentRevision(content: string): string {
  return embeddedDocumentRevision(content) ?? resourceRevision(content)
}

/** Stable revision for binary workspace documents without materializing an encoded copy. */
export function bytesContentRevision(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return `b1-${(hash >>> 0).toString(36)}-${bytes.byteLength.toString(36)}`
}
