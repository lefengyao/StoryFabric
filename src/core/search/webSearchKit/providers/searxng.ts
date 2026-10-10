/**
 * Self-hosted [SearXNG](https://github.com/searxng/searxng) as a search backend.
 *
 * SearXNG is a *metasearch proxy*: it holds no index and instead fans one query out
 * to the upstream engines you enable, then merges their results. Three consequences
 * shape this adapter and are deliberate design, not limitations to paper over:
 *
 * 1. **There is no batch endpoint.** One HTTP request carries one query. This
 *    adapter therefore does **not** implement `batchSearch` — declaring it would
 *    claim "one backend round trip" for what is really N calls, and the consumer
 *    (`runSearchQueries`) already fans out concurrently through `search`. What this
 *    adapter *does* add is the shared {@link RequestGate}, which bounds that fan-out so
 *    a multi-query tool call cannot burst the upstream engines into a CAPTCHA.
 * 2. **Upstream engines can refuse.** SearXNG reports that in `unresponsive_engines`.
 *    Returning an empty result there would tell the model "nothing matched" when the
 *    truth is "every backend we asked failed" — so that case raises a provider error
 *    instead of a silent, lying empty result.
 * 3. **Anonymous upstream access is the upstream's decision.** Google in particular
 *    starts CAPTCHAing a heavy instance. Keep `engines` short and `minIntervalMs`
 *    non-zero for anything beyond personal use.
 *
 * Wire contract: `GET {baseURL}/search?q=…&format=json`. `format=json` is **off by
 * default** in SearXNG and the instance answers HTTP 403 until `json` is added to
 * `search.formats` in `settings.yml`; this adapter recognizes that 403 and says so.
 * @module web-search-standalone/providers/searxng
 */

import { WEB_ABORTED, WEB_PROVIDER_ERROR, WebError } from '../types'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '../types'
import { USER_AGENT, RequestGate, isCancellation, isPositiveInteger, isValidBaseUrl, resolveSource, type FetchLike, type OptionsSource } from './shared'

/** Stable id this provider registers under. */
export const SEARXNG_PROVIDER_ID = 'searxng'

/** Default base URL: a SearXNG instance on the local machine. */
export const SEARXNG_DEFAULT_BASE_URL = 'http://127.0.0.1:8080'

/** Default cap on requests in flight at once. */
export const SEARXNG_DEFAULT_MAX_CONCURRENCY = 1

/** Default minimum gap between two request starts (ms). */
export const SEARXNG_DEFAULT_MIN_INTERVAL_MS = 250

/**
 * Raised when the instance answered, but every upstream engine it consulted was
 * unresponsive — so "no results" would be a wrong answer rather than an empty one.
 * Not in `NON_FAILOVER_CODES`, so a failover chain is right to try the next backend.
 */
export const SEARXNG_NO_UPSTREAM = 'SEARXNG_NO_UPSTREAM'

/** Time-range filter values SearXNG accepts for `time_range`. */
export type SearxngTimeRange = 'day' | 'week' | 'month' | 'year'

/* ── Provider-private wire types ───────────────────────────────────────────── */

/** One merged result from the upstream engines. */
export interface SearxngResult {
  url: string
  title?: string | null
  /** The result's summary text; SearXNG names this field `content`, not `snippet`. */
  content?: string | null
  publishedDate?: string | null
  /** Which upstream engine produced this entry (diagnostic only). */
  engine?: string | null
}

/** SearXNG's JSON envelope. Only the fields this adapter reads are declared. */
export interface SearxngResponse {
  query?: string
  number_of_results?: number
  results?: SearxngResult[]
  /** `[engine name, reason]` pairs for the engines that failed this query. */
  unresponsive_engines?: (readonly [string, string])[]
}

/* ── Options ───────────────────────────────────────────────────────────────── */

/** Provider options; defaults are applied when the provider is constructed. */
export interface SearxngSearchOptions {
  /** Instance base URL. Defaults to {@link SEARXNG_DEFAULT_BASE_URL}; `/search` is appended. */
  baseURL?: string
  /** HTTP client; defaults to the global `fetch`. */
  fetch?: FetchLike
  /** Extra request headers — for a reverse proxy in front of the instance. Setting
   *  any header switches redirects to `error`, since a header may carry a credential. */
  headers?: Record<string, string>
  /** Engine language filter, sent as `language`; omitted = the instance's default. */
  language?: string
  /** Result category, sent as `categories`; omitted = the instance's default. */
  categories?: string
  /** Restrict upstream engines by name. Fewer engines = fewer things that can flake. */
  engines?: readonly string[]
  /** Recency window, sent as `time_range`; omitted = no filter. */
  timeRange?: SearxngTimeRange
  /** Safe-search level, sent as `safesearch`; omitted = the instance's default. */
  safeSearch?: 0 | 1 | 2
  /** Cap on concurrent upstream requests. Constructor-time only. Defaults to {@link SEARXNG_DEFAULT_MAX_CONCURRENCY}. */
  maxConcurrency?: number
  /** Minimum gap between request starts in ms. Constructor-time only. Defaults to {@link SEARXNG_DEFAULT_MIN_INTERVAL_MS}. */
  minIntervalMs?: number
}

/** Options after defaults are applied. */
interface ResolvedSearxngOptions {
  readonly baseURL: string
  readonly fetch: FetchLike
  readonly headers: Record<string, string> | undefined
  readonly language: string | undefined
  readonly categories: string | undefined
  readonly engines: readonly string[] | undefined
  readonly timeRange: SearxngTimeRange | undefined
  readonly safeSearch: 0 | 1 | 2 | undefined
}

/* ── Response mapping ──────────────────────────────────────────────────────── */

/**
 * Map one SearXNG result entry to a normalized source.
 *
 * @param result - one entry of the envelope's `results[]`.
 * @returns the normalized source; blank optional fields are omitted rather than set empty.
 */
export function mapSearxngResult(result: SearxngResult): WebSearchSource {
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.content != null && result.content.length > 0 ? { snippet: result.content } : {},
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

/**
 * Map a SearXNG envelope to a normalized search result. SearXNG generates no answer
 * text, so `content` is always absent; `truncated` stays `false` because the runtime
 * owns the result cap.
 *
 * @param response - the parsed JSON body.
 * @returns the normalized result, index order preserved.
 */
export function mapSearxngResponse(response: SearxngResponse): WebSearchResult {
  return {
    sources: (response.results ?? []).map(mapSearxngResult),
    truncated: false,
  }
}

/**
 * Describe the engines that failed, when nothing usable came back at all.
 *
 * @param response - the parsed JSON body.
 * @returns a diagnosable message when the result set is empty *because* the upstream
 *   engines failed, otherwise `undefined` (a genuinely empty result is not an error).
 */
export function unresponsiveSummary(response: SearxngResponse): string | undefined {
  const failed = response.unresponsive_engines ?? []
  if (failed.length === 0 || (response.results?.length ?? 0) > 0) return undefined
  const detail = failed.map(([engine, reason]) => `${engine}: ${reason}`).join('; ')
  return `SearXNG returned no results and every upstream engine it consulted failed (${detail})`
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/** The SearXNG-backed search provider. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  private readonly gate: RequestGate

  /**
   * @param options - endpoints, filters and rate limits. Endpoint and filter fields are
   *   re-read for every operation (so a thunk can repoint the provider at another
   *   instance); the rate-limit fields are read once, here.
   */
  constructor(private readonly options: OptionsSource<SearxngSearchOptions>) {
    const resolved = resolveSource(options)
    this.gate = new RequestGate(
      resolved.maxConcurrency ?? SEARXNG_DEFAULT_MAX_CONCURRENCY,
      resolved.minIntervalMs ?? SEARXNG_DEFAULT_MIN_INTERVAL_MS,
    )
  }

  /**
   * True when the endpoint parses as an absolute URL. Deliberately offline: this is
   * read before every operation, and a reachability probe here would add a round trip
   * to every search. A dead instance is reported by `search` instead.
   */
  available(): boolean {
    return isValidBaseUrl(this.resolve().baseURL)
  }

  /**
   * Run one search.
   * @param request - the query; `maxResults` is forwarded as SearXNG's `count` to
   *   save upstream work, and the runtime still enforces the cap afterwards.
   * @param signal - cancellation signal, forwarded to `fetch`.
   * @returns the merged upstream results.
   * @throws {@link WebError} `WEB_ABORTED` on cancellation, `SEARXNG_NO_UPSTREAM` when
   *   every upstream engine failed, `WEB_PROVIDER_ERROR` otherwise.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolve()
    const release = await this.gate.acquire(signal)
    try {
      return await this.send(options, request, signal)
    } finally {
      release()
    }
  }

  /** Perform the guarded HTTP call and map the envelope. */
  private async send(
    options: ResolvedSearxngOptions,
    request: WebSearchRequest,
    signal?: AbortSignal,
  ): Promise<WebSearchResult> {
    const params = new URLSearchParams({ q: request.query, format: 'json' })
    if (request.maxResults !== undefined && isPositiveInteger(request.maxResults)) {
      params.set('count', String(request.maxResults))
    }
    if (options.language !== undefined) params.set('language', options.language)
    if (options.categories !== undefined) params.set('categories', options.categories)
    if (options.engines !== undefined) params.set('engines', options.engines.join(','))
    if (options.timeRange !== undefined) params.set('time_range', options.timeRange)
    if (options.safeSearch !== undefined) params.set('safesearch', String(options.safeSearch))

    const endpoint = `${options.baseURL.replace(/\/+$/, '')}/search?${params.toString()}`
    const hasCredential = options.headers !== undefined && Object.keys(options.headers).length > 0

    let response: Response
    try {
      response = await options.fetch(endpoint, {
        method: 'GET',
        // A caller-supplied header may be a credential, so never let a redirect
        // carry it to another origin. Without headers a redirect is harmless.
        redirect: hasCredential ? 'error' : 'follow',
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
          ...options.headers ?? {},
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw new WebError(
        `SearXNG instance at ${options.baseURL} is unreachable: ${String(error)}`,
        WEB_PROVIDER_ERROR,
        { cause: error },
      )
    }

    if (!response.ok) throw await httpFailure(response, signal)

    let payload: SearxngResponse
    try {
      payload = await response.json() as SearxngResponse
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw searchAborted(signal, error)
      throw new WebError(`SearXNG returned an unprocessable response body: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }

    const unresponsive = unresponsiveSummary(payload)
    if (unresponsive !== undefined) throw new WebError(unresponsive, SEARXNG_NO_UPSTREAM)
    return mapSearxngResponse(payload)
  }

  /** Apply defaults to one operation's options. */
  private resolve(): ResolvedSearxngOptions {
    const raw = resolveSource(this.options)
    return {
      baseURL: raw.baseURL ?? SEARXNG_DEFAULT_BASE_URL,
      fetch: raw.fetch ?? globalThis.fetch,
      headers: raw.headers,
      language: raw.language,
      categories: raw.categories,
      engines: raw.engines,
      timeRange: raw.timeRange,
      safeSearch: raw.safeSearch,
    }
  }
}

/** Build a SearXNG search provider. */
export function searxngSearchProvider(options: OptionsSource<SearxngSearchOptions>): SearxngSearchProvider {
  return new SearxngSearchProvider(options)
}

/** Turn an HTTP failure into a diagnosable error, naming the two common misconfigurations. */
async function httpFailure(response: Response, signal?: AbortSignal): Promise<WebError> {
  const status = response.status
  const base = `SearXNG responded with HTTP ${status}`
  if (status === 403) {
    return new WebError(
      `${base}: the instance refused the request. The usual cause is that \`json\` is missing from \`search.formats\` in settings.yml (the JSON API is off by default); a reversed proxy may also be rejecting it.`,
      WEB_PROVIDER_ERROR,
    )
  }
  if (status === 429) {
    return new WebError(
      `${base}: the instance is rate-limiting (its own \`server.limiter\` or an upstream engine's). Raise \`minIntervalMs\`, lower \`maxConcurrency\`, or trim \`engines\`.`,
      WEB_PROVIDER_ERROR,
    )
  }
  let detail: string | undefined
  try {
    const body = await response.text()
    const trimmed = body.trim()
    if (trimmed.length > 0) detail = trimmed.slice(0, 300)
  } catch (error: unknown) {
    // An abort mid-body is a cancellation, not an HTTP failure.
    if (isCancellation(error, signal)) throw searchAborted(signal, error)
    // Otherwise the status in `base` already carries the signal that matters.
  }
  return new WebError(detail === undefined ? base : `${base}: ${detail}`, WEB_PROVIDER_ERROR)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('SearXNG search aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
