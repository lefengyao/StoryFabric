/**
 * Perplexity search over its OpenAI-compatible chat-completions endpoint. Ported
 * from DeepSeek Harness `packages/web/web-search-perplexity/src/provider.ts`. The
 * generated answer becomes `content`; sources prefer structured `search_results[]`
 * and fall back to URL-only `citations[]`.
 * @module web-search-standalone/providers/perplexity
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
export const PERPLEXITY_PROVIDER_ID = 'perplexity'

/** Default Perplexity endpoint; `/chat/completions` is the operation. */
export const PERPLEXITY_DEFAULT_BASE_URL = 'https://api.perplexity.ai'

/** Default search model. */
export const PERPLEXITY_DEFAULT_MODEL = 'sonar'

/** Default upper bound on generated answer tokens. */
export const PERPLEXITY_DEFAULT_MAX_TOKENS = 1024

/** Recency filter values Perplexity accepts for `search_recency_filter`. */
export type PerplexityRecency = 'day' | 'week' | 'month' | 'year'

/* ── Provider-private wire types ───────────────────────────────────────────── */

/** One structured search result (the preferred citation shape). */
export interface PerplexitySearchResult {
  url: string
  title?: string | null
  snippet?: string | null
  date?: string | null
}

/** Perplexity's response envelope. */
export interface PerplexityResponse {
  choices?: { message?: { content?: string | null } }[]
  /** Structured citation data (preferred). */
  search_results?: PerplexitySearchResult[]
  /** URL-only citation fallback. */
  citations?: string[]
}

/** Perplexity's error response envelope (best-effort; fields vary). */
export interface PerplexityError {
  error?: { message?: string } | string
  message?: string
}

/* ── Options ───────────────────────────────────────────────────────────────── */

/** Provider options; defaults are applied when the provider is constructed. */
export interface PerplexitySearchOptions {
  /** Perplexity API key. Absent or empty makes the provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to {@link PERPLEXITY_DEFAULT_BASE_URL}. */
  baseURL?: string
  /** Search model name. Defaults to {@link PERPLEXITY_DEFAULT_MODEL}. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to {@link PERPLEXITY_DEFAULT_MAX_TOKENS}. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`; omitted = no filter. */
  searchRecency?: PerplexityRecency
  /** HTTP client; defaults to the global `fetch`. */
  fetch?: FetchLike
}

/** Options after defaults are applied. */
interface ResolvedPerplexityOptions {
  readonly apiKey: string
  readonly baseURL: string
  readonly model: string
  readonly maxTokens: number
  readonly searchRecency: PerplexityRecency | undefined
  readonly fetch: FetchLike
}

/* ── Response mapping ──────────────────────────────────────────────────────── */

/**
 * Map one structured Perplexity search result to a normalized source.
 *
 * @param result - one entry of the response's `search_results[]`.
 * @returns the normalized source; blank fields are omitted rather than set empty.
 */
export function mapPerplexityResult(result: PerplexitySearchResult): WebSearchSource {
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.snippet != null && result.snippet.length > 0 ? { snippet: result.snippet } : {},
    ...result.date != null && result.date.length > 0 ? { publishedAt: result.date } : {},
  }
}

/**
 * Map a Perplexity response envelope to a normalized search result. Prefers
 * structured `search_results[]`; falls back to URL-only `citations[]` (those
 * sources carry just a `url`) only when `search_results` is absent.
 *
 * @param response - the parsed chat-completions response body.
 * @returns the normalized result; `content` is omitted when the answer is empty.
 */
export function mapPerplexityResponse(response: PerplexityResponse): WebSearchResult {
  const content = response.choices?.[0]?.message?.content
  const sources: WebSearchSource[] = response.search_results !== undefined
    ? response.search_results.map(mapPerplexityResult)
    : (response.citations ?? []).map(url => ({ url }))
  return {
    ...content != null && content.length > 0 ? { content } : {},
    sources,
    truncated: false,
  }
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/** The Perplexity-backed search provider; HTTP redirects fail before the target is contacted. */
export class PerplexitySearchProvider implements WebSearchProvider {
  readonly id = PERPLEXITY_PROVIDER_ID

  /**
   * @param options - the options for the next operation; a thunk allows swapping
   *   the key, endpoint, model, or recency window between searches.
   */
  constructor(private readonly options: OptionsSource<PerplexitySearchOptions>) {}

  /** True when a key, a parseable endpoint, and valid limits are configured. */
  available(): boolean {
    const options = this.resolve()
    return options.apiKey.length > 0
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.maxTokens)
      && options.model.length > 0
  }

  /**
   * Run one search.
   * @param request - the query; Perplexity exposes no result-count control, so
   *   `maxResults` is enforced only by the runtime's post-hoc truncation.
   * @param signal - cancellation signal forwarded to `fetch`.
   * @returns the normalized result.
   * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_ERROR` otherwise.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolve()
    let response: Response
    try {
      response = await options.fetch(`${options.baseURL}/chat/completions`, {
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
          model: options.model,
          max_tokens: options.maxTokens,
          messages: [{ role: 'user', content: request.query }],
          ...options.searchRecency !== undefined ? { search_recency_filter: options.searchRecency } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw new WebError(`Perplexity search request failed: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Perplexity API error (HTTP ${status})`
      try {
        const parsed = await response.json() as PerplexityError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
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
      const payload = await response.json() as PerplexityResponse
      return mapPerplexityResponse(payload)
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw new WebError(`Perplexity returned an unprocessable response body: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }
  }

  /** Apply defaults to one operation's options. */
  private resolve(): ResolvedPerplexityOptions {
    const raw = resolveSource(this.options)
    return {
      apiKey: raw.apiKey ?? '',
      baseURL: raw.baseURL ?? PERPLEXITY_DEFAULT_BASE_URL,
      model: raw.model ?? PERPLEXITY_DEFAULT_MODEL,
      maxTokens: raw.maxTokens ?? PERPLEXITY_DEFAULT_MAX_TOKENS,
      searchRecency: raw.searchRecency,
      fetch: raw.fetch ?? globalThis.fetch,
    }
  }
}

/** Build a Perplexity search provider. */
export function perplexitySearchProvider(options: OptionsSource<PerplexitySearchOptions>): PerplexitySearchProvider {
  return new PerplexitySearchProvider(options)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Perplexity search aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
