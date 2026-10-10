/**
 * Exa search over `POST /search` with highlight contents. Ported from DeepSeek
 * Harness `packages/web/web-search-exa/src/provider.ts`. Exa returns no generated
 * answer, so results carry no `content` — only citeable sources. A result with no
 * non-blank highlight is dropped, so a call can return fewer sources than
 * requested.
 * @module web-search-standalone/providers/exa
 */

import { WEB_ABORTED, WEB_PROVIDER_ERROR, WebError } from '../types'
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
export const EXA_PROVIDER_ID = 'exa'

/** Default Exa search endpoint; `/search` is the operation. */
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai'

/** Default retrieval mode: let Exa pick between keyword and neural search. */
export const EXA_DEFAULT_SEARCH_TYPE = 'auto'

/** Default number of highlight sentences requested per result. */
export const EXA_DEFAULT_HIGHLIGHTS_PER_RESULT = 1

/* ── Provider-private wire types ───────────────────────────────────────────── */

/** Request body sent to Exa's search endpoint. */
export interface ExaSearchRequest {
  query: string
  /** Retrieval mode: keyword, neural (embeddings), or auto (Exa decides). */
  type: 'auto' | 'keyword' | 'neural'
  /** Exa's result-count control; the runtime still enforces the bound on return. */
  numResults?: number
  /** Ask Exa to return highlight sentences per result. */
  contents: { highlights: { highlightsPerUrl: number } }
}

/** One entry of Exa's flat `results[]`. */
export interface ExaResult {
  url: string
  title?: string | null
  publishedDate?: string | null
  highlights?: string[]
}

/** Exa's search response envelope. */
export interface ExaSearchResponse {
  results?: ExaResult[]
}

/** Exa's error response envelope (best-effort; fields vary by failure). */
export interface ExaError {
  error?: string
  message?: string
}

/* ── Options ───────────────────────────────────────────────────────────────── */

/** Provider options; defaults are applied when the provider is constructed. */
export interface ExaSearchOptions {
  /** Exa API key. Absent or empty makes the provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to {@link EXA_DEFAULT_BASE_URL}. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
  /** HTTP client; defaults to the global `fetch`. */
  fetch?: FetchLike
}

/** Options after defaults are applied. */
interface ResolvedExaOptions {
  readonly apiKey: string
  readonly baseURL: string
  readonly searchType: 'auto' | 'keyword' | 'neural'
  readonly numResults: number | undefined
  readonly highlightsPerResult: number
  readonly fetch: FetchLike
}

/* ── Response mapping ──────────────────────────────────────────────────────── */

/**
 * Map one Exa result to a normalized source, or `undefined` when it carries no
 * portable snippet (an entry with no highlight is dropped — the seam has no other
 * field to derive a snippet from, and inventing one would lie).
 *
 * @param result - one entry of Exa's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no non-blank highlight.
 */
export function mapExaResult(result: ExaResult): WebSearchSource | undefined {
  const snippet = result.highlights?.find(highlight => highlight.trim().length > 0)
  if (snippet === undefined) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    snippet,
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

/**
 * Map an Exa response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /search` response body.
 * @returns the normalized result; snippet-less entries are dropped.
 */
export function mapExaResponse(response: ExaSearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapExaResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Exa returns no generated answer, so `content` is omitted. The runtime owns
  // the final truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/** The Exa-backed search provider; HTTP redirects fail before the target is contacted. */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = EXA_PROVIDER_ID

  /**
   * @param options - the options for the next operation; a thunk allows swapping
   *   the key, endpoint, or retrieval mode between searches.
   */
  constructor(private readonly options: OptionsSource<ExaSearchOptions>) {}

  /** True when a key, a parseable endpoint, and valid limits are configured. */
  available(): boolean {
    const options = this.resolve()
    return options.apiKey.length > 0
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.highlightsPerResult)
      && (options.numResults === undefined || isPositiveInteger(options.numResults))
  }

  /**
   * Run one search.
   * @param request - the query and optional result bound.
   * @param signal - cancellation signal forwarded to `fetch`.
   * @returns the normalized result.
   * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_ERROR` otherwise.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolve()
    // A per-request bound wins over the configured default; either may be absent.
    const numResults = request.maxResults ?? options.numResults
    let response: Response
    try {
      response = await options.fetch(`${options.baseURL}/search`, {
        method: 'POST',
        // Never follow a redirect: the request carries the API key.
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          type: options.searchType,
          contents: { highlights: { highlightsPerUrl: options.highlightsPerResult } },
          ...numResults !== undefined ? { numResults } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw new WebError(`Exa search request failed: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Exa API error (HTTP ${status})`
      try {
        const parsed = await response.json() as ExaError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider error.
        if (isCancellation(error, signal)) throw searchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body can only cost a richer provider message.
      }
      throw new WebError(message, WEB_PROVIDER_ERROR)
    }

    try {
      const payload = await response.json() as ExaSearchResponse
      return mapExaResponse(payload)
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }
  }

  /** Apply defaults to one operation's options. */
  private resolve(): ResolvedExaOptions {
    const raw = resolveSource(this.options)
    return {
      apiKey: raw.apiKey ?? '',
      baseURL: raw.baseURL ?? EXA_DEFAULT_BASE_URL,
      searchType: raw.searchType ?? EXA_DEFAULT_SEARCH_TYPE,
      numResults: raw.numResults,
      highlightsPerResult: raw.highlightsPerResult ?? EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
      fetch: raw.fetch ?? globalThis.fetch,
    }
  }
}

/** Build an Exa search provider. */
export function exaSearchProvider(options: OptionsSource<ExaSearchOptions>): ExaSearchProvider {
  return new ExaSearchProvider(options)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Exa search aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
