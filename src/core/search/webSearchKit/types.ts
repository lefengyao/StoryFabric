/**
 * Vocabulary for the extracted web search seam: provider contract, the portable
 * citation result, and the machine-routable error. Ported from DeepSeek Harness
 * `packages/web/web/src/types.ts`, with the fetch half removed and
 * `WebError extends HarnessError` replaced by a local base class.
 * @module web-search-standalone/types
 */

/** What one search-capable backend is asked to search. Each request carries one query. */
export interface WebSearchRequest {
  /** The search query. */
  readonly query: string
  /**
   * Upper bound on returned sources. The runtime truncates to it, so a provider
   * whose API has a result-count control should also apply it at the request
   * layer as a cost and latency optimization.
   */
  readonly maxResults?: number
}

/**
 * Normalized search outcome. `content` is optional provider-generated answer
 * text (Exa and DeepSeek return none; Perplexity returns a generated answer).
 * `truncated` is set by the runtime when it cut `sources[]` down to `maxResults`.
 */
export interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  readonly content?: string
  /** Citeable sources, already truncated to the request's `maxResults`. */
  readonly sources: readonly WebSearchSource[]
  /** True when the runtime or the multi-query merge dropped sources to honor the cap. */
  readonly truncated: boolean
}

/**
 * One citeable source. A source always has a URL; the other fields are optional
 * because not every provider returns them — inventing them would make the seam
 * lie (Perplexity's citation fallback is URL-only). Display renders
 * `title ?? hostname(url)`.
 */
export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** Publication or crawl timestamp as a provider-supplied ISO-8601 string. */
  readonly publishedAt?: string
}

/**
 * What one extraction-capable backend is asked to retrieve. The URL is fetched by
 * the backend — for an MCP backend that means a third-party server, so local
 * process SSRF defenses do not apply to it.
 */
export interface WebExtractRequest {
  readonly url: string
}

/** Normalized extraction outcome: the readable body of one public page. */
export interface WebExtractResult {
  /** The final URL the backend reports, when it differs from the request. */
  readonly url: string
  /** Readable body, typically Markdown. */
  readonly content: string
  /** True when the backend capped the body. */
  readonly truncated: boolean
}

/**
 * A search-capable backend. `id` is a stable string, unique within the runtime's
 * registry. The two optional operations are capabilities, not requirements: the
 * consumer falls back (for batching) or fails loudly (for extraction) when a
 * provider does not implement them.
 */
export interface WebSearchProvider {
  readonly id: string
  /** Cheap local usability check (credential presence, parseable config); must not make network calls. */
  available(): boolean
  /** Run one search; honor `signal` for cancellation. */
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
  /**
   * Run several searches in one backend round trip. Absent = unsupported. Returns
   * `undefined` when this particular call cannot be batched (a composed provider
   * whose batching backend just failed), and the consumer then fans out through
   * {@link search}. Results are index-aligned with `requests`.
   */
  batchSearch?(
    requests: readonly WebSearchRequest[],
    signal?: AbortSignal,
  ): Promise<readonly WebSearchResult[] | undefined>
  /** Retrieve one page's readable body. Absent = unsupported. */
  extract?(request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult>
}

/** A configured provider id that is not registered. */
export const WEB_PROVIDER_CONFIGURED_MISSING = 'WEB_PROVIDER_CONFIGURED_MISSING'
/** A configured provider id that is registered but reports `available() === false`. */
export const WEB_PROVIDER_CONFIGURED_UNAVAILABLE = 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE'
/** No provider configured and none usable. */
export const WEB_PROVIDER_UNAVAILABLE = 'WEB_PROVIDER_UNAVAILABLE'
/** No provider configured and more than one usable. */
export const WEB_PROVIDER_AMBIGUOUS = 'WEB_PROVIDER_AMBIGUOUS'
/** Two providers registered under one id (a registration-time programming error). */
export const WEB_DUPLICATE_PROVIDER = 'WEB_DUPLICATE_PROVIDER'
/** The caller cancelled. */
export const WEB_ABORTED = 'WEB_ABORTED'
/** A provider or transport failure surfaced through the seam. */
export const WEB_PROVIDER_ERROR = 'WEB_PROVIDER_ERROR'
/** A provider is selected but has no usable credential. */
export const WEB_PROVIDER_CREDENTIAL_MISSING = 'WEB_PROVIDER_CREDENTIAL_MISSING'
/** The selected provider does not implement the requested operation. */
export const WEB_UNSUPPORTED_OPERATION = 'WEB_UNSUPPORTED_OPERATION'
/** The tool call's arguments violated the declared schema or its value constraints. */
export const INVALID_ARGS = 'INVALID_ARGS'
/** The tool call exceeded its declared deadline. */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/**
 * Error with a machine-routable, open-string `code` and chained `cause`. Codes
 * are an open set: a provider may raise its own, so callers route on the code
 * they know and must tolerate an unknown one.
 */
export class WebError extends Error {
  /** Stable machine-routable failure class; route on this, never by parsing `message`. */
  readonly code: string

  /**
   * @param message - human-readable failure description.
   * @param code - stable machine-routable class.
   * @param options - standard error options; `cause` chains the underlying failure.
   */
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = new.target.name
  }
}
