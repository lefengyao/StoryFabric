/**
 * Client for the self-hosted **Web Content Service** — one base URL that answers both
 * halves of the problem, speaking the contract in `selfhosted/CONTRACT.md`.
 *
 * This is the provider to use when you have bound a deployment on your own server. It
 * differs from the two direct adapters in one important way:
 *
 * | | `searxngSearchProvider` + `readableExtractProvider` | `webContentProvider` |
 * |---|---|---|
 * | talks to | a SearXNG instance and an extractor, separately | one service, one token |
 * | `batchSearch` | not offered (SearXNG has no batch endpoint) | **real**: the contract's `queries[]` runs the whole batch in one round trip |
 * | throttling | per client process | centralized in the gateway, shared by every client |
 *
 * The batch point is the substantive one. `runSearchQueries` sends a model's `queries`
 * array as a single request here, so a five-query tool call costs one HTTP round trip
 * instead of five — and the gateway's own gate is what keeps the upstream engines from
 * being burst, which no per-client limiter can do.
 *
 * Everything about the wire format lives in the contract, not here; this file is the
 * translation between that contract and the `WebSearchProvider` seam.
 * @module web-search-standalone/providers/webcontent
 */

import { WEB_ABORTED, WEB_PROVIDER_ERROR, WEB_UNSUPPORTED_OPERATION, WebError } from '../types'
import type { WebExtractRequest, WebExtractResult, WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '../types'
import { USER_AGENT, isCancellation, isPositiveInteger, isValidBaseUrl, resolveSource, type FetchLike, type OptionsSource } from './shared'

/** Stable id this provider registers under. */
export const WEBCONTENT_PROVIDER_ID = 'webcontent'

/** Default base URL: the service on the local machine. */
export const WEBCONTENT_DEFAULT_BASE_URL = 'http://127.0.0.1:8090'

/** Canonical search path from the contract. */
export const WEBCONTENT_DEFAULT_SEARCH_PATH = '/v1/search'

/** Canonical extraction path from the contract. */
export const WEBCONTENT_DEFAULT_EXTRACT_PATH = '/v1/extract'

/** Extraction modes the contract defines. */
export type WebContentMode = 'static' | 'render' | 'auto'

/* ── Provider-private wire types ───────────────────────────────────────────── */

/** One source as the contract returns it. Only `url` is guaranteed. */
interface WireSource {
  url?: unknown
  title?: unknown
  snippet?: unknown
  publishedAt?: unknown
}

/** One query's result as the contract returns it. */
interface WireResult {
  query?: unknown
  sources?: unknown
  truncated?: unknown
}

/** The `/v1/search` envelope. */
interface WireSearchResponse {
  backend?: unknown
  results?: unknown
}

/** The `/v1/extract` envelope. */
interface WireExtractResponse {
  url?: unknown
  content?: unknown
  truncated?: unknown
}

/** The contract's error envelope. */
interface WireErrorEnvelope {
  error?: { code?: unknown; message?: unknown; retryable?: unknown }
  detail?: unknown
}

/* ── Options ───────────────────────────────────────────────────────────────── */

/** Provider options; defaults are applied when the provider is constructed. */
export interface WebContentProviderOptions {
  /** Service base URL. Defaults to {@link WEBCONTENT_DEFAULT_BASE_URL}. */
  baseURL?: string
  /** Bearer token, when the service requires one. Sent as an `Authorization` header. */
  token?: string
  /** Override the operation paths, for a different implementation of the same contract. */
  searchPath?: string
  extractPath?: string
  /** Extra headers, for a reverse proxy in front of the service. */
  extraHeaders?: Record<string, string>
  /** Default extraction mode when a caller does not name one. Omitted = the service's
   *  own default (`static`), which is what a per-site override should usually start from. */
  mode?: WebContentMode
  /** Cap on the body requested from the service. The `web_extract` tool applies its own
   *  cap afterwards, so this only bounds what crosses the wire. */
  maxContentChars?: number
  /** HTTP client; defaults to the global `fetch`. */
  fetch?: FetchLike
}

/** Options after defaults are applied. */
interface ResolvedWebContentOptions {
  readonly baseURL: string
  readonly token: string | undefined
  readonly searchPath: string
  readonly extractPath: string
  readonly extraHeaders: Record<string, string> | undefined
  readonly mode: WebContentMode | undefined
  readonly maxContentChars: number | undefined
  readonly fetch: FetchLike
}

/* ── Response mapping ──────────────────────────────────────────────────────── */

/** Return a non-empty string, or `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Map one wire source.
 *
 * @param source - one entry of `results[].sources`.
 * @returns the normalized source, or `undefined` when it is not citeable.
 */
function mapSource(source: WireSource): WebSearchSource | undefined {
  const url = text(source.url)
  // A source without a URL cannot be cited, and inventing one would make this layer lie.
  if (url === undefined) return undefined
  const title = text(source.title)
  const snippet = text(source.snippet)
  const publishedAt = text(source.publishedAt)
  return {
    url,
    ...title !== undefined ? { title } : {},
    ...snippet !== undefined ? { snippet } : {},
    ...publishedAt !== undefined ? { publishedAt } : {},
  }
}

/**
 * Map a `/v1/search` envelope for one query.
 *
 * @param response - the parsed body.
 * @param index - which entry of `results` to read.
 * @param expected - the query that entry should answer; a mismatch is a contract violation.
 * @returns the normalized search result.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when the envelope is not what the contract promises.
 */
export function mapWebContentSearch(response: WireSearchResponse, index: number, expected: string): WebSearchResult {
  const results = response.results
  if (!Array.isArray(results)) {
    throw new WebError('the service returned no `results` array; is it speaking contract v1?', WEB_PROVIDER_ERROR)
  }
  const entry = results[index] as WireResult | undefined
  if (entry === undefined || typeof entry !== 'object') {
    throw new WebError(
      `the service returned ${results.length} result(s) for ${index + 1} queries, so results cannot be paired with queries`,
      WEB_PROVIDER_ERROR,
    )
  }
  // The contract echoes the query back. When it is present it must be the one asked for:
  // silently accepting a mismatch would attach one query's sources to another query, which
  // is the single worst failure this seam can have.
  const echoed = text(entry.query)
  if (echoed !== undefined && echoed !== expected) {
    throw new WebError(
      `the service answered query ${JSON.stringify(echoed)} where ${JSON.stringify(expected)} was asked for; results cannot be trusted`,
      WEB_PROVIDER_ERROR,
    )
  }
  const sources = Array.isArray(entry.sources) ? entry.sources : []
  return {
    sources: sources
      .filter((source): source is WireSource => typeof source === 'object' && source !== null)
      .map(mapSource)
      .filter((source): source is WebSearchSource => source !== undefined),
    truncated: entry.truncated === true,
  }
}

/**
 * Map a `/v1/extract` envelope.
 *
 * @param response - the parsed body.
 * @param requestedUrl - the URL asked for, used when the service reports none.
 * @returns the normalized extraction. An empty body is a real answer here, not an error.
 */
export function mapWebContentExtract(response: WireExtractResponse, requestedUrl: string): WebExtractResult {
  return {
    url: text(response.url) ?? requestedUrl,
    content: typeof response.content === 'string' ? response.content : '',
    truncated: response.truncated === true,
  }
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/** The self-hosted Web Content Service provider. */
export class WebContentProvider implements WebSearchProvider {
  readonly id = WEBCONTENT_PROVIDER_ID

  /**
   * @param options - endpoint, credential and defaults. Read per operation, so a thunk can
   *   rotate the token or repoint the provider without rebuilding it.
   */
  constructor(private readonly options: OptionsSource<WebContentProviderOptions>) {}

  /** True when the endpoint parses as an absolute URL. Deliberately offline. */
  available(): boolean {
    return isValidBaseUrl(this.resolve().baseURL)
  }

  /**
   * Run one search.
   * @param request - the query and source cap.
   * @param signal - cancellation, forwarded to `fetch`.
   * @returns the normalized result.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    return this.runSearch([request], signal)
  }

  /**
   * Run several searches in **one** backend round trip.
   *
   * The contract's `queries[]` runs the whole batch server-side, so unlike the direct
   * SearXNG adapter this is genuinely one request rather than a fan-out wearing a batch
   * costume. Returns `undefined` — never a partial answer — when the service replies with
   * a different arity than was asked for, so the consumer can fall back to its own fan-out.
   *
   * @param requests - the queries, in order.
   * @param signal - cancellation.
   * @returns one result per request, index-aligned; `undefined` when the batch cannot be used.
   */
  async batchSearch(requests: readonly WebSearchRequest[], signal?: AbortSignal): Promise<WebSearchResult[] | undefined> {
    if (requests.length === 0) return []

    let response: WireSearchResponse
    try {
      response = await this.post<WireSearchResponse>('search', {
        queries: requests.map(request => request.query),
        ...this.sharedSearchFields(requests),
      }, signal)
    } catch (error: unknown) {
      // A batch that the service cannot serve must degrade to the consumer's fan-out
      // rather than fail the call, but a cancellation is not a degradation.
      if (error instanceof WebError && error.code === WEB_ABORTED) throw error
      return undefined
    }

    const results = response.results
    if (!Array.isArray(results) || results.length !== requests.length) return undefined
    return requests.map((request, index) => mapWebContentSearch(response, index, request.query))
  }

  /**
   * Retrieve a page's readable body.
   * @param request - the URL.
   * @param signal - cancellation.
   * @returns the extracted body; `truncated` reflects the service's own cap.
   */
  async extract(request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult> {
    const options = this.resolve()
    const response = await this.post<WireExtractResponse>('extract', {
      url: request.url,
      ...options.mode !== undefined ? { mode: options.mode } : {},
      ...options.maxContentChars !== undefined ? { maxChars: options.maxContentChars } : {},
    }, signal)
    return mapWebContentExtract(response, request.url)
  }

  /** Run one search through the shared path, so `search` and `batchSearch` cannot diverge. */
  private async runSearch(requests: readonly WebSearchRequest[], signal?: AbortSignal): Promise<WebSearchResult> {
    const response = await this.post<WireSearchResponse>('search', {
      queries: requests.map(request => request.query),
      ...this.sharedSearchFields(requests),
    }, signal)
    return mapWebContentSearch(response, 0, requests[0]?.query ?? '')
  }

  /** Fields the contract applies to the batch as a whole, not per query. */
  private sharedSearchFields(requests: readonly WebSearchRequest[]): Record<string, unknown> {
    // The seam is per-request but the contract caps the batch, so the smallest cap wins:
    // returning more than a caller asked for is a worse failure than returning fewer.
    const caps = requests.map(request => request.maxResults).filter((cap): cap is number => cap !== undefined && isPositiveInteger(cap))
    return caps.length > 0 ? { maxResults: Math.min(...caps) } : {}
  }

  /** One JSON POST against the contract, with errors classified by the service's codes. */
  private async post<T>(operation: 'search' | 'extract', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const options = this.resolve()
    const path = operation === 'search' ? options.searchPath : options.extractPath
    const hasCredential = options.token !== undefined
      || (options.extraHeaders !== undefined && Object.keys(options.extraHeaders).length > 0)

    let response: Response
    try {
      response = await options.fetch(`${trimSlash(options.baseURL)}${path}`, {
        method: 'POST',
        // A token is a credential, so never let a redirect carry it to another origin.
        redirect: hasCredential ? 'error' : 'follow',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
          ...options.token !== undefined ? { 'authorization': `Bearer ${options.token}` } : {},
          ...options.extraHeaders ?? {},
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw aborted(signal, error)
      throw new WebError(`Web Content Service at ${options.baseURL} is unreachable: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }

    if (!response.ok) throw await this.failure(response, operation, signal)

    try {
      return await response.json() as T
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw aborted(signal, error)
      throw new WebError(`the service returned an unprocessable body: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }
  }

  /** Turn a non-2xx response into an error that keeps the service's own code in the message. */
  private async failure(response: Response, operation: string, signal?: AbortSignal): Promise<WebError> {
    let detail = ''
    try {
      const raw = await response.text()
      const parsed = JSON.parse(raw) as WireErrorEnvelope
      const code = text(parsed.error?.code)
      const message = text(parsed.error?.message) ?? text(parsed.detail)
      detail = code === undefined ? raw.slice(0, 300) : `[${code}] ${message ?? ''}`.trim()
    } catch (error: unknown) {
      if (isCancellation(error, signal)) return aborted(signal, error)
      // The status still carries the signal that matters.
    }
    const guidance = response.status === 501
      ? ' (the service is not configured for this capability; check its /v1/health)'
      : response.status === 401
        ? ' (check the token passed to webContentProvider)'
        : ''
    return new WebError(
      `Web Content Service refused ${operation} with HTTP ${response.status}${guidance}${detail === '' ? '' : `: ${detail}`}`,
      // A 501 is a configuration fact about the deployment, not a broken backend.
      response.status === 501 ? WEB_UNSUPPORTED_OPERATION : WEB_PROVIDER_ERROR,
    )
  }

  /** Apply defaults to one operation's options. */
  private resolve(): ResolvedWebContentOptions {
    const raw = resolveSource(this.options)
    return {
      baseURL: raw.baseURL ?? WEBCONTENT_DEFAULT_BASE_URL,
      token: raw.token,
      searchPath: raw.searchPath ?? WEBCONTENT_DEFAULT_SEARCH_PATH,
      extractPath: raw.extractPath ?? WEBCONTENT_DEFAULT_EXTRACT_PATH,
      extraHeaders: raw.extraHeaders,
      mode: raw.mode,
      maxContentChars: raw.maxContentChars,
      fetch: raw.fetch ?? globalThis.fetch,
    }
  }
}

/** Build a Web Content Service provider. */
export function webContentProvider(options: OptionsSource<WebContentProviderOptions>): WebContentProvider {
  return new WebContentProvider(options)
}

/** Strip trailing slashes so a path can be appended without doubling them. */
function trimSlash(baseURL: string): string {
  return baseURL.replace(/\/+$/, '')
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Web Content Service call aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
