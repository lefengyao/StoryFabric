/**
 * Turn a search backend's free-form payload into the portable source shape.
 *
 * MCP servers answer with prose or markdown reports; provider-native search
 * returns structured blocks but often only as prose citations. Both need the same
 * last-resort extraction, so it lives here once rather than in each provider.
 * @module web-search-standalone/providers/text-sources
 */

import type { WebSearchResult, WebSearchSource } from '../types'

const IMAGE_PREFIX = '!'
const MARKDOWN_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g
const BARE_URL = /https?:\/\/[^\s<>()[\]"'`]+/g
const HEADING = /^(#{1,4})\s*(.*)$/
const URL_FIELD = /^\s*[-*]?\s*\*{0,2}URL\*{0,2}\s*[:：]\s*(\S+)\s*$/i
const TITLE_FIELD = /^\s*\*{0,2}Title\*{0,2}\s*[:：]\s*(.+)$/i
const META_FIELD = /^\s*[-*]?\s*\*{0,2}(Published|Author|Date|Source|Score|Language|Highlights|Site|URL)\*{0,2}\s*[:：]/i
const NUMBERED = /^\d+[.)]\s*/

/** Strip markdown emphasis and backticks from an inline value. */
function cleanInline(value: string): string {
  return value.replace(/\*{1,2}/g, '').replace(/`/g, '').trim()
}

/** Strip trailing punctuation an inline URL picked up from prose. */
export function cleanUrl(value: string): string {
  let url = cleanInline(value).replace(/[.,;:*]+$/, '')
  if (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1)
  return url
}

/** Case-insensitive URL dedupe, preserving first-occurrence order. */
export function dedupeSources(sources: readonly WebSearchSource[]): WebSearchSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = source.url.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Collect `{url,title,snippet}` triples from an already-parsed JSON value,
 * wherever they sit in the tree. Vendor payloads nest result arrays differently,
 * so the walker looks for the portable fields instead of a fixed path.
 *
 * @param value - a parsed JSON value.
 * @returns every source found, in document order.
 */
export function sourcesFromValue(value: unknown): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url : undefined
    if (url !== undefined && /^https?:\/\//.test(url)) {
      const title = typeof record.title === 'string' && record.title.length > 0 ? record.title : undefined
      const snippet = typeof record.snippet === 'string' && record.snippet.length > 0
        ? record.snippet
        : typeof record.description === 'string' && record.description.length > 0 ? record.description : undefined
      const publishedAt = typeof record.publishedAt === 'string' && record.publishedAt.length > 0
        ? record.publishedAt
        : typeof record.date === 'string' && record.date.length > 0 ? record.date : undefined
      sources.push({
        url,
        ...title !== undefined ? { title } : {},
        ...snippet !== undefined ? { snippet } : {},
        ...publishedAt !== undefined ? { publishedAt } : {},
      })
      return
    }
    for (const nested of Object.values(record)) visit(nested, depth + 1)
  }
  visit(value, 0)
  return sources
}

/**
 * Collect sources from the two report layouts MCP search servers actually return:
 * a `Title:` / `URL:` record block (Exa) and a numbered heading followed by a
 * `- **URL**:` line (Anysearch). Both carry a title and a prose excerpt that a
 * bare-URL scan would throw away.
 *
 * @param text - the tool's text payload.
 * @returns the sources found; empty when the payload is not a report.
 */
export function sourcesFromRecords(text: string): WebSearchSource[] {
  const out: WebSearchSource[] = []
  let title: string | undefined
  let url: string | undefined
  let snippet: string | undefined
  const flush = (): void => {
    if (url !== undefined) {
      out.push({
        url,
        ...title !== undefined ? { title } : {},
        ...snippet !== undefined ? { snippet } : {},
      })
    }
    title = undefined
    url = undefined
    snippet = undefined
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue

    const heading = HEADING.exec(line)
    if (heading !== null) {
      const body = (heading[2] ?? '').trim()
      // A numbered heading names a result; so does a deep one. A shallow bare
      // heading ("## Search Results", "# owner/repo") is a section marker.
      const numbered = NUMBERED.test(body)
      if ((numbered || (heading[1] ?? '').length >= 3) && body.length > 0) {
        flush()
        title = cleanInline(body.replace(NUMBERED, ''))
      }
      continue
    }

    const urlField = URL_FIELD.exec(line)
    if (urlField !== null) {
      if (url !== undefined) flush()
      url = cleanUrl(urlField[1] as string)
      continue
    }

    const titleField = TITLE_FIELD.exec(line)
    if (titleField !== null) {
      const value = cleanInline(titleField[1] as string)
      if (url !== undefined) flush()
      if (title === undefined) title = value
      continue
    }

    if (META_FIELD.test(line)) continue
    const candidate = cleanInline(line.replace(/^[-*]\s*/, ''))
    // Ellipsis separators and stray bullets are not excerpts.
    if (snippet === undefined && candidate.length >= 3 && !/^[.\u2026]+$/.test(candidate)) snippet = candidate
  }

  flush()
  return out
}

/** Collect citeable sources from Markdown links, then from bare URLs. */
export function sourcesFromText(text: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  let withoutLinks = text
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const url = match[2] as string
    // `![alt](url)` is an image, not a citation.
    if (match.index !== undefined && text[match.index - 1] === IMAGE_PREFIX) continue
    const title = (match[1] as string).trim()
    sources.push({ url, ...title.length > 0 ? { title } : {} })
    withoutLinks = withoutLinks.replace(match[0], ' ')
  }
  if (sources.length > 0) return sources
  for (const match of withoutLinks.matchAll(BARE_URL)) sources.push({ url: cleanUrl(match[0]) })
  return sources
}

/**
 * Turn one backend's text payload into a normalized result. The shapes below are
 * the ones real backends return, in the order they are tried:
 *
 * 1. a JSON document carrying a result array;
 * 2. a report layout — numbered headings plus `- **URL**:` lines (Anysearch), or
 *    `Title:` / `URL:` records (Exa) — which also carries titles and excerpts;
 * 3. markdown links;
 * 4. bare URLs.
 *
 * The raw text becomes `content` only when no structured source was found at all,
 * so a payload's links are never repeated back to the model twice.
 *
 * @param text - the backend's text payload.
 * @returns the normalized result.
 */
export function parseSearchText(text: string): WebSearchResult {
  const trimmed = text.trim()
  const structured = trimmed.startsWith('{') || trimmed.startsWith('[')
    ? parseJsonSources(trimmed)
    : undefined
  const records = structured === undefined ? sourcesFromRecords(text) : undefined
  const sources = dedupeSources(structured ?? (records !== undefined && records.length > 0 ? records : sourcesFromText(text)))
  if (sources.length === 0) {
    return {
      sources: [],
      truncated: false,
      ...trimmed.length > 0 ? { content: trimmed } : {},
    }
  }
  return { sources, truncated: false }
}

/** Parse a JSON text payload and collect its sources, or `undefined`. */
function parseJsonSources(text: string): WebSearchSource[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const sources = sourcesFromValue(parsed)
  return sources.length > 0 ? sources : undefined
}
