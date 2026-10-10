/**
 * MCP-backed search provider: one JSON-RPC `tools/call` per operation against a
 * hosted MCP server.
 *
 * Ported from the AstrBot `astrbot_plugin_anysearch` client, with three defects
 * fixed and one capability added:
 *
 * 1. **SSE-tolerant responses.** An MCP Streamable HTTP endpoint may answer with
 *    `text/event-stream` frames rather than one JSON document. The payload parser
 *    tries the whole body first, then each `data: ` line (the approach opencode
 *    uses), instead of failing on `json.loads`.
 * 2. **Structured errors.** Failures carry a routable {@link WebError} code, so a
 *    caller can tell "the model sent bad arguments" from "the server is down".
 *    The harness plugin returned a formatted string for both.
 * 3. **Redirect refusal and cancellation.** Requests set `redirect: 'error'` so a
 *    credential-bearing request is never forwarded to another origin, and the
 *    caller's `AbortSignal` reaches `fetch`.
 *
 * The added capability is `batchSearch`: when the profile names a batch tool, one
 * round trip serves every query in a multi-query call.
 * @module web-search-standalone/providers/mcp
 */

import { WEB_ABORTED, WEB_PROVIDER_CREDENTIAL_MISSING, WEB_PROVIDER_ERROR, WebError } from '../types'
import type {
  WebExtractRequest,
  WebExtractResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../types'
import { USER_AGENT, isCancellation, type FetchLike } from './shared'
import { resolveProfile, type McpProfileRef, type McpSearchProfile } from './mcp-profiles'
import { parseSearchText } from './text-sources'

/** Default result count requested on the wire when a request carries no cap. */
export const MCP_DEFAULT_WIRE_MAX_RESULTS = 5

/** The exact outbound call recorded immediately before dispatch. */
export interface McpRequestRecord {
  /** Fully resolved JSON-RPC endpoint. */
  readonly endpoint: string
  /** MCP tool name. */
  readonly tool: string
  /** Exact JSON-RPC `params.arguments` sent. */
  readonly args: Record<string, unknown>
}

/** Provider options. */
export interface McpSearchProviderOptions {
  /** A shipped profile id (`anysearch`, `exa-mcp`, `parallel-mcp`) or a full profile. */
  readonly profile: McpProfileRef
  /** Literal key; when present it wins over {@link resolveApiKey}. */
  readonly apiKey?: string
  /** Resolve the key for one operation (env, keychain, secrets store). */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** HTTP client; defaults to the global `fetch`. */
  readonly fetch?: FetchLike
  /** Record the exact outbound request before dispatch; a throw prevents dispatch. */
  readonly onRequest?: (record: McpRequestRecord) => void
  /** Result cap requested on the wire. Defaults to 5. */
  readonly wireMaxResults?: number
  /**
   * Also set `content` to the server's raw text even when structured sources were
   * extracted. Defaults to false: the sources already carry the links, and
   * repeating them spends context twice.
   */
  readonly includeRawText?: boolean
  /** Override the payload parser. Defaults to {@link parseSearchText}. */
  readonly parseSearchText?: (text: string) => WebSearchResult
}

/* ── Response parsing ──────────────────────────────────────────────────────── */

/** One JSON-RPC envelope, narrowed to what this provider reads. */
interface McpEnvelope {
  readonly result?: {
    readonly content?: readonly { readonly type?: string; readonly text?: string }[]
  }
  readonly error?: unknown
}

/** Decode one JSON document into an envelope, or `undefined` when it is not JSON. */
function decodeEnvelope(payload: string): McpEnvelope | undefined {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    return JSON.parse(trimmed) as McpEnvelope
  } catch {
    return undefined
  }
}

/**
 * Find the JSON-RPC envelope in a response body that may be a single JSON
 * document or a stream of SSE frames.
 *
 * @param body - the raw response body.
 * @returns the first decodable envelope, or `undefined`.
 */
export function parseMcpEnvelope(body: string): McpEnvelope | undefined {
  const direct = decodeEnvelope(body)
  if (direct !== undefined) return direct
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue
    // `data: [DONE]` and other non-JSON frames are skipped, not fatal.
    const frame = decodeEnvelope(line.slice(6))
    if (frame !== undefined) return frame
  }
  return undefined
}

/** Render a JSON-RPC `error` member as a message. */
function mcpErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message : undefined
    const code = typeof record.code === 'number' || typeof record.code === 'string' ? String(record.code) : undefined
    if (message !== undefined && code !== undefined) return `${message} (code ${code})`
    if (message !== undefined) return message
  }
  return JSON.stringify(error) ?? 'unknown MCP error'
}

/** The first `text` content item of an envelope, or `undefined`. */
function textContent(envelope: McpEnvelope): string | undefined {
  const content = envelope.result?.content
  if (!Array.isArray(content)) return undefined
  for (const item of content) {
    if (typeof item?.text === 'string') return item.text
  }
  return undefined
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/** Options after defaults are applied. */
interface ResolvedMcpOptions {
  readonly profile: McpSearchProfile
  readonly apiKey: string | undefined
  readonly resolveApiKey: (() => Promise<string | undefined>) | undefined
  readonly fetch: FetchLike
  readonly record: ((record: McpRequestRecord) => void) | undefined
  readonly wireMaxResults: number
  readonly includeRawText: boolean
  readonly parseSearchText: (text: string) => WebSearchResult
}

/**
 * The MCP-backed search provider. It carries no vendor knowledge of its own: the
 * profile supplies the endpoint, the tool names, and the argument names, so one
 * class serves every MCP search server.
 */
export class McpSearchProvider implements WebSearchProvider {
  readonly id: string

  /** Present only when the profile names a batch tool. */
  readonly batchSearch?: (requests: readonly WebSearchRequest[], signal?: AbortSignal) => Promise<readonly WebSearchResult[]>

  /** Present only when the profile names an extract tool. */
  readonly extract?: (request: WebExtractRequest, signal?: AbortSignal) => Promise<WebExtractResult>

  private readonly options: ResolvedMcpOptions

  /**
   * @param options - the profile plus the key source, HTTP client, and observability hook.
   */
  constructor(options: McpSearchProviderOptions) {
    const profile = resolveProfile(options.profile)
    this.options = {
      profile,
      apiKey: options.apiKey,
      resolveApiKey: options.resolveApiKey,
      fetch: options.fetch ?? globalThis.fetch,
      record: options.onRequest,
      wireMaxResults: options.wireMaxResults ?? MCP_DEFAULT_WIRE_MAX_RESULTS,
      includeRawText: options.includeRawText ?? false,
      parseSearchText: options.parseSearchText ?? parseSearchText,
    }
    this.id = profile.id
    if (profile.tools.batch !== undefined && profile.buildBatchArgs !== undefined) {
      this.batchSearch = (requests, signal) => this.runBatch(requests, signal)
    }
    if (profile.tools.extract !== undefined && profile.buildExtractArgs !== undefined) {
      this.extract = (request, signal) => this.runExtract(request, signal)
    }
  }

  /** True when the endpoint parses and, if the profile requires it, a key is available. */
  available(): boolean {
    const { profile } = this.options
    if (!URL.canParse(profile.endpoint)) return false
    if (profile.auth?.required === true) {
      return (this.options.apiKey?.length ?? 0) > 0 || this.options.resolveApiKey !== undefined
    }
    return true
  }

  /**
   * Run one search.
   * @param request - the query; `maxResults` is honored on the wire when the
   *   profile maps it, and enforced again by the runtime on the way back.
   * @param signal - cancellation signal forwarded to `fetch`.
   * @returns the normalized result.
   * @throws {@link WebError} `WEB_ABORTED`, `WEB_PROVIDER_CREDENTIAL_MISSING`, or `WEB_PROVIDER_ERROR`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const { profile } = this.options
    const args = profile.buildSearchArgs(request, { maxResults: request.maxResults ?? this.options.wireMaxResults })
    const text = await this.call(profile.tools.search, args, signal)
    const parsed = this.options.parseSearchText(text)
    return this.options.includeRawText && parsed.content === undefined
      ? { ...parsed, content: text.trim() }
      : parsed
  }

  /** Run every request in one backend round trip. */
  private async runBatch(
    requests: readonly WebSearchRequest[],
    signal?: AbortSignal,
  ): Promise<readonly WebSearchResult[]> {
    const { profile } = this.options
    const tool = profile.tools.batch as string
    const build = profile.buildBatchArgs as NonNullable<McpSearchProfile['buildBatchArgs']>
    const args = build(requests, { maxResults: this.options.wireMaxResults })
    const text = await this.call(tool, args, signal)
    return this.splitBatchText(text, requests.length)
  }

  /**
   * Split one batch response across its requests. A server that answers with a
   * JSON array of per-query result sets is matched by index; anything else is
   * parsed as a single merged payload and repeated for the first request, so the
   * caller still gets real sources instead of an arity mismatch.
   */
  private splitBatchText(text: string, count: number): readonly WebSearchResult[] {
    const perQuery = splitJsonArray(text)
    if (perQuery !== undefined && perQuery.length === count) {
      return perQuery.map(entry => this.options.parseSearchText(typeof entry === 'string' ? entry : JSON.stringify(entry)))
    }
    const merged = this.options.parseSearchText(text)
    return Array.from({ length: count }, (_unused, index) => (index === 0 ? merged : { sources: [], truncated: false }))
  }

  /** Retrieve one page's body. */
  private async runExtract(request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult> {
    const { profile } = this.options
    const tool = profile.tools.extract as string
    const build = profile.buildExtractArgs as NonNullable<McpSearchProfile['buildExtractArgs']>
    const text = await this.call(tool, build(request.url), signal)
    return { url: request.url, content: text.trim(), truncated: false }
  }

  /**
   * Dispatch one `tools/call` and return its text content.
   * @param tool - MCP tool name.
   * @param args - argument object for the profile's server.
   * @param signal - caller cancellation.
   * @returns the first `text` content item.
   */
  private async call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const options = this.options
    const endpoint = options.profile.endpoint
    const headers = await this.headers(signal)
    options.record?.({ endpoint, tool, args })
    throwIfAborted(signal)

    let response: Response
    try {
      response = await options.fetch(endpoint, {
        method: 'POST',
        // An MCP endpoint reached with a credential must not be redirected.
        redirect: 'error',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw mcpAborted(error, signal)
      throw new WebError(`MCP search request failed: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }

    let body: string
    try {
      body = await response.text()
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw mcpAborted(error, signal)
      throw new WebError(`MCP search response could not be read: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }

    if (!response.ok) {
      const detail = body.trim().slice(0, 500)
      throw new WebError(
        `${endpoint} responded HTTP ${response.status}${detail.length > 0 ? `: ${detail}` : ''}`,
        WEB_PROVIDER_ERROR,
      )
    }

    const envelope = parseMcpEnvelope(body)
    if (envelope === undefined) {
      throw new WebError(`${endpoint} returned no JSON-RPC payload`, WEB_PROVIDER_ERROR)
    }
    if (envelope.error !== undefined) {
      throw new WebError(`${tool} failed: ${mcpErrorMessage(envelope.error)}`, WEB_PROVIDER_ERROR)
    }
    const text = textContent(envelope)
    if (text === undefined) {
      throw new WebError(`${tool} returned no text content`, WEB_PROVIDER_ERROR)
    }
    return text
  }

  /** Build the request headers, resolving a credential when the profile has one. */
  private async headers(signal?: AbortSignal): Promise<Record<string, string>> {
    const options = this.options
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Both shapes are accepted because MCP Streamable HTTP may answer with SSE.
      'accept': 'application/json, text/event-stream',
      'user-agent': USER_AGENT,
    }
    const auth = options.profile.auth
    if (auth === undefined) return headers
    const key = await this.resolveKey(auth.required === true, signal)
    if (key !== undefined && key.length > 0) {
      headers[auth.header] = auth.scheme === undefined ? key : `${auth.scheme} ${key}`
    }
    return headers
  }

  /** Resolve this operation's credential; absent is acceptable for anonymous profiles. */
  private async resolveKey(required: boolean, signal?: AbortSignal): Promise<string | undefined> {
    const options = this.options
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    if (options.resolveApiKey === undefined) {
      if (required) throw missingKey(options.profile)
      return undefined
    }
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey()
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw mcpAborted(error, signal)
      throw new WebError(`credential resolution failed: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    if (required) throw missingKey(options.profile)
    return undefined
  }
}

/** Build an MCP search provider. */
export function mcpSearchProvider(options: McpSearchProviderOptions): McpSearchProvider {
  return new McpSearchProvider(options)
}

/** Parse a top-level JSON array payload, or `undefined`. */
function splitJsonArray(text: string): readonly unknown[] | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Build the credential-missing error for a profile that needs one. */
function missingKey(profile: McpSearchProfile): WebError {
  const ref = profile.auth?.ref ?? 'the profile key'
  return new WebError(
    `MCP search endpoint ${profile.endpoint} has no credential for "${ref}";`
    + ' supply it through the apiKey option or return it from resolveApiKey.',
    WEB_PROVIDER_CREDENTIAL_MISSING,
  )
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function mcpAborted(fallback?: unknown, signal?: AbortSignal): WebError {
  return new WebError('MCP search aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** Throw when the caller already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw mcpAborted(signal, signal)
}

// Re-exported so this module keeps its published surface after the extraction.
export { parseSearchText } from './text-sources'
