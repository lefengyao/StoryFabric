/**
 * DeepSeek search through an Anthropic-compatible Messages call with the native
 * `web_search_20250305` server tool. Ported from DeepSeek Harness
 * `packages/web/web-search-deepseek/src/provider.ts`: the wire format, response
 * mapping, credential handling, and redirect policy are unchanged; the Cordis
 * plugin, settings section, and session-event recording were replaced by the
 * `onRequest` hook and a plain options object.
 *
 * The wire format and native `fetch` client are provider-private and do not use
 * a model adapter.
 * @module web-search-standalone/providers/deepseek
 */

import {
  WEB_ABORTED,
  WEB_PROVIDER_CREDENTIAL_MISSING,
  WEB_PROVIDER_ERROR,
  WebError,
} from '../types'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '../types'
import {
  USER_AGENT,
  isCancellation,
  isPositiveInteger,
  isValidBaseUrl,
  resolveSource,
  type FetchLike,
  type OptionsSource,
} from './shared'

/** Stable id this provider registers under. */
export const DEEPSEEK_PROVIDER_ID = 'deepseek-official'

/**
 * Default endpoint: DeepSeek's Anthropic-compatible API, `/v1` included
 * (`/messages` is appended). This is NOT the chat-completions base
 * (`https://api.deepseek.com`), so this provider does not reuse a chat base URL —
 * only the API key is shared. Distinct from the chat base by design: search
 * speaks the Messages API.
 */
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'

/** Default Anthropic-format model name. */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash'

/** Default `anthropic-version` header value. */
export const DEEPSEEK_DEFAULT_API_VERSION = '2023-06-01'

/** Default upper bound on generated tokens for the Messages request. */
export const DEEPSEEK_DEFAULT_MAX_TOKENS = 4096

/** Default maximum `web_search` server-tool uses per request. */
export const DEEPSEEK_DEFAULT_MAX_USES = 5

/** Credential reference named by missing-credential diagnostics. */
export const DEEPSEEK_DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/* ── Provider-private wire types ───────────────────────────────────────────── */

/** A `web_search_result` item inside a `web_search_tool_result` block. */
interface WebSearchResultItem {
  type: string
  url: string
  title?: string | null
  /** Provider-supplied page age/recency string (mapped to `publishedAt`). */
  page_age?: string | null
}

/** A `web_search_tool_result` content block: the citeable result shape. */
interface WebSearchToolResultBlock {
  type: 'web_search_tool_result'
  content?: WebSearchResultItem[]
}

/** One citation location inside a `text` block (the snippet source). */
interface CitationLocation {
  type?: string
  url?: string | null
  cited_text?: string | null
}

/** A `text` content block: the model's prose plus per-URL citations. */
interface AnthropicTextBlock {
  type: 'text'
  text?: string | null
  citations?: CitationLocation[]
}

/** Any content block; only `web_search_tool_result` and `text` are consumed. */
type ContentBlock = WebSearchToolResultBlock | AnthropicTextBlock | { type: string }

/** DeepSeek's Anthropic Messages response envelope. */
export interface AnthropicResponse {
  content?: ContentBlock[]
}

/** DeepSeek's error response envelope (best-effort; fields vary). */
export interface AnthropicError {
  error?: { message?: string } | string
  message?: string
}

/** The exact secret-free DeepSeek Messages request recorded before one search dispatch. */
export interface DeepSeekSearchRequest {
  /** Fully resolved Messages endpoint. */
  readonly endpoint: string
  /** `anthropic-version` header value. */
  readonly apiVersion: string
  /** Exact JSON body sent to the provider. */
  readonly body: {
    readonly model: string
    readonly max_tokens: number
    readonly messages: readonly [{
      readonly role: 'user'
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
    }]
    readonly tools: readonly [{
      readonly type: 'web_search_20250305'
      readonly name: 'web_search'
      readonly max_uses: number
    }]
  }
}

/* ── Options ───────────────────────────────────────────────────────────────── */

/** Provider options; every field has a documented default applied at construction. */
export interface DeepSeekSearchOptions {
  /** Literal API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current API key for one search operation (keychain, env, secrets store). */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. Defaults to `DEEPSEEK_API_KEY`. */
  apiKeyRef?: string
  /** Endpoint base; `/messages` is appended. Defaults to {@link DEEPSEEK_DEFAULT_BASE_URL}. */
  baseURL?: string
  /** Anthropic-format model name. Defaults to {@link DEEPSEEK_DEFAULT_MODEL}. */
  model?: string
  /** `anthropic-version` header value. Defaults to {@link DEEPSEEK_DEFAULT_API_VERSION}. */
  apiVersion?: string
  /** Upper bound on generated tokens. Defaults to {@link DEEPSEEK_DEFAULT_MAX_TOKENS}. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to {@link DEEPSEEK_DEFAULT_MAX_USES}. */
  maxUses?: number
  /**
   * Record the exact secret-free request immediately before dispatch — the hook
   * that replaces the harness session event. A throw prevents dispatch, so
   * model-visible auxiliary input cannot escape logging.
   */
  onRequest?: (request: DeepSeekSearchRequest) => void
  /** Extra sentence appended to post-dispatch failure messages. */
  endpointHint?: string
  /** HTTP client; defaults to the global `fetch`. */
  fetch?: FetchLike
}

/** Options after defaults are applied. */
interface ResolvedDeepSeekOptions {
  readonly apiKey: string | undefined
  readonly resolveApiKey: (() => Promise<string | undefined>) | undefined
  readonly apiKeyRef: string
  readonly baseURL: string
  readonly model: string
  readonly apiVersion: string
  readonly maxTokens: number
  readonly maxUses: number
  readonly onRequest: ((request: DeepSeekSearchRequest) => void) | undefined
  readonly endpointHint: string | undefined
  readonly fetch: FetchLike
}

/* ── Response mapping ──────────────────────────────────────────────────────── */

/**
 * Build a `url → cited_text` map from every `text` block's `citations[]`. This is
 * the snippet source: Anthropic `web_search_result` items carry
 * `url`/`title`/`page_age` but typically NO inline snippet — the excerpt lives in
 * a separate `text` block's citation, keyed by `url` (first occurrence wins).
 *
 * @param blocks - the response's content blocks; non-`text` blocks are skipped.
 * @returns the `url → cited_text` map (empty when no citations are present).
 */
export function citationSnippets(blocks: readonly ContentBlock[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'text') continue
    for (const cite of (block as AnthropicTextBlock).citations ?? []) {
      if (cite.url != null && cite.url.length > 0 && cite.cited_text != null && cite.cited_text.length > 0 && !map.has(cite.url)) {
        map.set(cite.url, cite.cited_text)
      }
    }
  }
  return map
}

/**
 * Map a DeepSeek Anthropic Messages response to a normalized search result.
 * Walks `web_search_tool_result` blocks for citeable `web_search_result` items,
 * joins each to its citation excerpt as `snippet`, and dedupes by `url` (a
 * `max_uses > 1` request can surface the same URL across searches). The runtime
 * owns the final `maxResults` truncation, so `truncated` is always `false` here.
 *
 * @param response - the parsed Messages response body.
 * @returns the normalized result with deduped, snippet-joined sources.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when native search produced no result block.
 */
export function mapAnthropicResponse(response: AnthropicResponse): WebSearchResult {
  const blocks = response.content ?? []
  const resultBlocks = blocks.filter(
    (block): block is WebSearchToolResultBlock => block.type === 'web_search_tool_result',
  )
  if (resultBlocks.length === 0) {
    throw new WebError(
      'DeepSeek returned no web_search_tool_result blocks; the request may not have triggered native web search',
      WEB_PROVIDER_ERROR,
    )
  }

  const snippets = citationSnippets(blocks)
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const block of resultBlocks) {
    for (const item of block.content ?? []) {
      if (item.type !== 'web_search_result' || item.url.length === 0 || seen.has(item.url)) continue
      seen.add(item.url)
      const snippet = snippets.get(item.url)
      sources.push({
        url: item.url,
        ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
        ...snippet != null && snippet.length > 0 ? { snippet } : {},
        ...item.page_age != null && item.page_age.length > 0 ? { publishedAt: item.page_age } : {},
      })
    }
  }
  return { sources, truncated: false }
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/**
 * The DeepSeek-backed search provider. One search costs a full Messages model
 * turn with server-side retrieval. HTTP redirects fail as `WEB_PROVIDER_ERROR`
 * before the `Location` target is contacted, so the API key is never forwarded
 * to another origin. Failures after dispatch name the endpoint.
 */
export class DeepSeekSearchProvider implements WebSearchProvider {
  readonly id = DEEPSEEK_PROVIDER_ID

  /**
   * @param options - the options for the next operation, snapshotted once at each
   *   operation's entry so one search never mixes two configurations. Accepts a
   *   thunk so a caller can change endpoint, key, or limits between searches
   *   without re-registering the provider.
   */
  constructor(private readonly options: OptionsSource<DeepSeekSearchOptions>) {}

  /** True when a key source, a parseable endpoint, and valid limits are configured. */
  available(): boolean {
    const options = this.resolve()
    return (options.apiKey !== undefined && options.apiKey.length > 0 || options.resolveApiKey !== undefined)
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.maxTokens)
      && isPositiveInteger(options.maxUses)
      && options.model.length > 0
  }

  /**
   * Run one search.
   * @param request - the query; `maxResults` is enforced by the runtime, because
   *   the Messages API exposes no result-count control.
   * @param signal - cancellation signal forwarded to `fetch`.
   * @returns the normalized result.
   * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_CREDENTIAL_MISSING`
   *   without a key, and `WEB_PROVIDER_ERROR` for transport, HTTP, or body failures.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // configuration write landing inside that await must not send the key
    // resolved from the old options to the endpoint named by the new ones.
    const options = this.resolve()
    const apiKey = await this.apiKey(options, signal)
    throwIfAborted(signal)
    const endpoint = `${options.baseURL}/messages`
    const body: DeepSeekSearchRequest['body'] = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `Perform a web search for the query: ${request.query}` }],
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: options.maxUses }],
    }
    options.onRequest?.({ endpoint, apiVersion: options.apiVersion, body })
    throwIfAborted(signal)
    let response: Response
    try {
      response = await options.fetch(endpoint, {
        method: 'POST',
        // Never follow a redirect: the request carries the API key.
        redirect: 'error',
        headers: {
          // Official DeepSeek expects `x-api-key`; an Anthropic-compatible proxy
          // may expect `Authorization: Bearer` — send both so either resolves.
          'x-api-key': apiKey,
          'authorization': `Bearer ${apiKey}`,
          'anthropic-version': options.apiVersion,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw searchEndpointError(endpoint, options.endpointHint, `DeepSeek search request failed: ${String(error)}`, error)
    }

    if (!response.ok) {
      const status = response.status
      let message = `DeepSeek API error (HTTP ${status})`
      try {
        const parsed = await response.json() as AnthropicError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message += `: ${detail}`
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider error.
        if (isCancellation(error, signal)) throw searchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw searchEndpointError(endpoint, options.endpointHint, message)
    }

    try {
      const payload = await response.json() as AnthropicResponse
      return mapAnthropicResponse(payload)
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      const message = error instanceof WebError
        ? error.message
        : `DeepSeek returned an unprocessable response body: ${String(error)}`
      throw searchEndpointError(endpoint, options.endpointHint, message, error)
    }
  }

  /** Apply defaults to one operation's options. */
  private resolve(): ResolvedDeepSeekOptions {
    const raw = resolveSource(this.options)
    return {
      apiKey: raw.apiKey,
      resolveApiKey: raw.resolveApiKey,
      apiKeyRef: raw.apiKeyRef ?? DEEPSEEK_DEFAULT_API_KEY_REF,
      baseURL: raw.baseURL ?? DEEPSEEK_DEFAULT_BASE_URL,
      model: raw.model ?? DEEPSEEK_DEFAULT_MODEL,
      apiVersion: raw.apiVersion ?? DEEPSEEK_DEFAULT_API_VERSION,
      maxTokens: raw.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
      maxUses: raw.maxUses ?? DEEPSEEK_DEFAULT_MAX_USES,
      onRequest: raw.onRequest,
      endpointHint: raw.endpointHint,
      fetch: raw.fetch ?? globalThis.fetch,
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one configuration.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   * @throws {@link WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when no layer supplies one.
   */
  private async apiKey(options: ResolvedDeepSeekOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw new WebError(
        `DeepSeek search credential resolution failed: ${String(error)}`,
        WEB_PROVIDER_ERROR,
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `DeepSeek search has no API key for "${options.apiKeyRef}"; supply it through the apiKey option,`
      + ' return it from resolveApiKey, or point apiKeyRef at whatever your credential layer resolves.',
      WEB_PROVIDER_CREDENTIAL_MISSING,
    )
  }
}

/** Build a DeepSeek search provider. */
export function deepseekSearchProvider(options: OptionsSource<DeepSeekSearchOptions>): DeepSeekSearchProvider {
  return new DeepSeekSearchProvider(options)
}

/* ── Failure helpers ───────────────────────────────────────────────────────── */

/** Add endpoint recovery instructions to failures that occur after request dispatch begins. */
function searchEndpointError(endpoint: string, hint: string | undefined, message: string, cause?: unknown): WebError {
  const guidance = hint ?? 'Search endpoint configuration is separate from chat; point the provider\'s baseURL option at a trusted Anthropic-compatible Messages API base.'
  return new WebError(
    `${message}\n\nThe web search request used endpoint ${JSON.stringify(endpoint)}. ${guidance}`,
    WEB_PROVIDER_ERROR,
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('DeepSeek search aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
