export interface ToolBodyPreviewOptions {
  toolName: string
  contentPath: string[]
}

const PREVIEW_SCAN_INTERVAL = 1024
const SMALL_BUFFER_SCAN_LIMIT = 4096
const MAX_PARTIAL_SCAN_BYTES = 65536
const MAX_PREVIEW_CHARS = 12000

interface StringResult {
  value: string
  end: number
  complete: boolean
}

interface LocatedString {
  value: string
  complete: boolean
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function skipWhitespace(text: string, start: number): number {
  let index = start
  while (isWhitespace(text[index])) index++
  return index
}

function decodeFragment(raw: string): string {
  try { return JSON.parse(`"${raw}"`) as string } catch {
    return raw
      .replace(/\\(["\\/bfnrt])/g, (_match, code: string) => ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[code] ?? code))
      .replace(/\\u[0-9a-fA-F]{0,3}$/g, '')
  }
}

function readString(text: string, start: number): StringResult | null {
  if (text[start] !== '"') return null
  let raw = ''
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]
    if (char === '"') return { value: decodeFragment(raw), end: index + 1, complete: true }
    if (char === '\\') {
      if (index + 1 >= text.length) return { value: decodeFragment(raw), end: text.length, complete: false }
      raw += text.slice(index, index + 2)
      index++
      continue
    }
    raw += char
  }
  // A trailing escape is not a reliable part of the visible preview.
  if (raw.endsWith('\\') || /\\u[0-9a-fA-F]{0,3}$/.test(raw)) raw = raw.replace(/(?:\\u[0-9a-fA-F]{0,3}|\\)$/, '')
  else if (/\\(?:["\\/bfnrt])$/.test(raw)) raw = raw.slice(0, -2)
  return { value: decodeFragment(raw), end: text.length, complete: false }
}

function skipValue(text: string, start: number): number {
  const index = skipWhitespace(text, start)
  const char = text[index]
  if (char === '"') return readString(text, index)?.end ?? text.length
  if (char === '{') {
    let cursor = index + 1
    while (cursor < text.length) {
      cursor = skipWhitespace(text, cursor)
      if (text[cursor] === '}') return cursor + 1
      const key = readString(text, cursor)
      if (!key?.complete) return text.length
      cursor = skipWhitespace(text, key.end)
      if (text[cursor] !== ':') return text.length
      cursor = skipValue(text, cursor + 1)
      if (cursor >= text.length) return text.length
      cursor = skipWhitespace(text, cursor)
      if (text[cursor] === ',') cursor++
      else if (text[cursor] === '}') return cursor + 1
      else return text.length
    }
    return text.length
  }
  if (char === '[') {
    let cursor = index + 1
    while (cursor < text.length) {
      cursor = skipWhitespace(text, cursor)
      if (text[cursor] === ']') return cursor + 1
      cursor = skipValue(text, cursor)
      if (cursor >= text.length) return text.length
      cursor = skipWhitespace(text, cursor)
      if (text[cursor] === ',') cursor++
      else if (text[cursor] === ']') return cursor + 1
      else return text.length
    }
    return text.length
  }
  let cursor = index
  while (cursor < text.length && !',]}'.includes(text[cursor])) cursor++
  return cursor
}

function findStringAtPath(text: string, path: string[], start = 0, pathIndex = 0): LocatedString | null {
  const index = skipWhitespace(text, start)
  if (pathIndex === path.length) {
    const value = readString(text, index)
    return value ? { value: value.value, complete: value.complete } : null
  }
  if (text[index] !== '{') return null
  let cursor = index + 1
  while (cursor < text.length) {
    cursor = skipWhitespace(text, cursor)
    if (text[cursor] === '}') return null
    const key = readString(text, cursor)
    if (!key?.complete) return null
    cursor = skipWhitespace(text, key.end)
    if (text[cursor] !== ':') return null
    cursor = skipWhitespace(text, cursor + 1)
    if (key.value === path[pathIndex]) {
      const found = findStringAtPath(text, path, cursor, pathIndex + 1)
      if (found) return found
    } else {
      cursor = skipValue(text, cursor)
    }
    cursor = skipWhitespace(text, cursor)
    if (text[cursor] === ',') cursor++
    else if (text[cursor] === '}') return null
    else return null
  }
  return null
}

export class ToolBodyPreview {
  private buffer = ''
  private readonly decoder = new TextDecoder()
  private preview = ''
  private complete = false
  private lastScanLength = 0

  constructor(private readonly options: ToolBodyPreviewOptions) {
    if (!options.toolName.trim()) throw new Error('toolName 不能为空')
    if (!options.contentPath.length || options.contentPath.some((part) => !part.trim())) throw new Error('contentPath 必须是非空路径')
  }

  push(chunk: string | Uint8Array): string | null {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    const previousPreview = this.preview
    const shouldScan = !this.complete && this.preview.length < MAX_PREVIEW_CHARS && (
      this.buffer.length <= SMALL_BUFFER_SCAN_LIMIT ||
      this.buffer.length - this.lastScanLength >= PREVIEW_SCAN_INTERVAL
    ) && (this.preview.length > 0 || this.buffer.length <= MAX_PARTIAL_SCAN_BYTES)
    if (!shouldScan) return this.preview ? null : ''
    this.lastScanLength = this.buffer.length
    const found = findStringAtPath(this.buffer, this.options.contentPath)
    if (found) this.preview = found.value.slice(0, MAX_PREVIEW_CHARS)
    this.complete = false
    if (found?.complete) {
      try {
        const parsed = JSON.parse(this.buffer) as unknown
        this.complete = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      } catch {
        this.complete = false
      }
    }
    if (this.preview !== previousPreview) return this.preview
    return this.preview ? null : ''
  }

  isComplete(): boolean { return this.complete }

  replace(value: string): string | null {
    this.buffer = ''
    this.preview = ''
    this.complete = false
    this.lastScanLength = 0
    return this.push(value)
  }

  getArguments(): Record<string, unknown> | null {
    if (!this.complete) return null
    try {
      const parsed = JSON.parse(this.buffer) as unknown
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
    } catch { return null }
  }
}
