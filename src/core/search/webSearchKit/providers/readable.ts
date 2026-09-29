/**
 * Readable-body extraction against a self-hosted backend — the counterpart to
 * {@link searxngSearchProvider}: SearXNG finds the URLs, this retrieves them.
 *
 * It speaks two dialects, because the two self-hostable options trade off differently:
 *
 * - **`plain`** — a small HTTP wrapper around [Trafilatura](https://github.com/adbar/trafilatura),
 *   which leads the content-extraction benchmarks (F1 ≈ 0.86–0.91 vs Readability's
 *   ≈ 0.80 and Firecrawl's ≈ 0.52, measured on the WCXB gold set). Thousands of pages
 *   per hour on one core. Static fetch by default: a client-rendered page yields
 *   nothing — but pass `render: true` to instead have the sidecar load the page in
 *   headless Chromium first and extract from the settled DOM. That is the *same*
 *   open-source browser Firecrawl drives, without Firecrawl's queue stack
 *   (Postgres + RabbitMQ + Redis + a separate Playwright service, 12 GB+ of RAM).
 *   Costs about 115 MB of browser binary and 250–400 MB RSS per Chromium.
 * - **`firecrawl`** — a self-hosted [Firecrawl](https://github.com/firecrawl/firecrawl),
 *   which renders pages in headless Chromium, so it handles SPAs and PDFs that
 *   `plain` cannot. Costs a browser pool: ~4 vCPU / 8 GB for the API plus
 *   ~2 vCPU / 4 GB for the Playwright service. Worth it for its anti-bot tier and
 *   operational maturity, not for the rendering itself.
 *
 * Either fits the *same* provider, so the choice stays a configuration change.
 *
 * Two boundaries worth stating outright:
 *
 * - **This provider does not search.** `search` throws `WEB_UNSUPPORTED_OPERATION`.
 *   Compose it *after* a search provider with `fallbackSearchProvider`, whose extract
 *   chain skips providers that do not implement `extract`. The reverse does not hold:
 *   `search` is a required interface member, so a search chain that ends up failing
 *   will list this provider as one more attempted backend. That line is expected, not
 *   a misconfiguration — the real cause is still named ahead of it in the same report.
 * - **This provider does not validate the URL.** `assertPublicHttpUrl` in the
 *   `web_extract` tool already rejects credentials-in-URL, `localhost`, and private
 *   address literals before a provider is reached. Note that this guard is now doing
 *   real work rather than only protecting a third party: with a self-hosted extractor
 *   the fetch happens inside *your* perimeter, so a private address that slipped
 *   through would make the extractor an internal-network probe. It is still not a
 *   complete SSRF defense — no DNS resolution is performed, so DNS rebinding is
 *   unaddressed. The extractor should therefore bind to loopback or a private
 *   interface, never to a public one.
 * @module web-search-standalone/providers/readable
 */

import { WEB_ABORTED, WEB_PROVIDER_ERROR, WEB_UNSUPPORTED_OPERATION, WebError } from '../types'
import type { WebExtractRequest, WebExtractResult, WebSearchProvider, WebSearchRequest, WebSearchResult } from '../types'
import { USER_AGENT, RequestGate, isCancellation, isPositiveInteger, isValidBaseUrl, resolveSource, type FetchLike, type OptionsSource } from './shared'

/** Stable id this provider registers under. */
export const READABLE_PROVIDER_ID = 'readable'

/** Which backend shape to speak. */
export type ReadableDialect = 'plain' | 'firecrawl'

/** Default base URL for a local Trafilatura sidecar. */
export const READABLE_DEFAULT_PLAIN_BASE_URL = 'http://127.0.0.1:8090'

/** Default base URL for a local Firecrawl. */
export const READABLE_DEFAULT_FIRECRAWL_BASE_URL = 'http://127.0.0.1:3002'

/** Path the plain service exposes, as stated in the contract (CONTRACT.md). */
export const READABLE_DEFAULT_EXTRACT_PATH = '/v1/extract'

/** Path Firecrawl exposes the scrape operation at. */
export const READABLE_DEFAULT_SCRAPE_PATH = '/v2/scrape'

/** Default cap on extractions in flight at once. */
export const READABLE_DEFAULT_MAX_CONCURRENCY = 2

/** Default minimum gap between two extraction starts (ms). */
export const READABLE_DEFAULT_MIN_INTERVAL_MS = 0

/* ── Provider-private wire types ───────────────────────────────────────────── */

/** The plain sidecar's response envelope. */
export interface PlainExtractResponse {
  /** The final URL after redirects, when the sidecar reports one. */
  url?: string | null
  /** Readable body. `markdown` is accepted as an alias so either field name works. */
  content?: string | null
  markdown?: string | null
  /** True when the sidecar cut the body itself (for example at `maxChars`). */
  truncated?: boolean | null
}

/** Firecrawl's scrape response envelope. */
export interface FirecrawlResponse {
  success?: boolean
  error?: string | null
  data?: {
    markdown?: string | null
    content?: string | null
    metadata?: {
      sourceURL?: string | null
      url?: string | null
      statusCode?: number | null
    } | null
  } | null
}

/* ── Options ───────────────────────────────────────────────────────────────── */

/** Provider options; defaults are applied when the provider is constructed. */
export interface ReadableExtractOptions {
  /** Backend base URL. Defaults to the URL matching `dialect`. */
  baseURL?: string
  /** Which backend shape to speak. Defaults to `plain`. */
  dialect?: ReadableDialect
  /** HTTP client; defaults to the global `fetch`. */
  fetch?: FetchLike
  /** Bearer token. Only Firecrawl uses it, and a self-hosted Firecrawl normally runs
   *  with authentication off (`USE_DB_AUTHENTICATION=false`). Omitted = no header. */
  apiKey?: string
  /** Extra request headers — for a reverse proxy. Setting any header (or an `apiKey`)
   *  switches redirects to `error`, since a header may carry a credential. */
  headers?: Record<string, string>
  /** Character cap sent to the `plain` sidecar as `maxChars`, so a huge page is not
   *  pulled over the wire only to be cut. Only the `plain` dialect honors it, and the
   *  `web_extract` tool still applies its own cap afterwards. */
  maxContentChars?: number
  /**
   * Path the extraction operation lives at, appended to `baseURL`. Defaults to
   * `/v1/extract` for the `plain` dialect and `/v2/scrape` for `firecrawl`.
   *
   * Override it to talk to an older deployment (which served `/extract` before the
   * contract was versioned) or to a different implementation of the same contract.
   */
  operationPath?: string
  /**
   * Render the page in headless Chromium before extracting. Sent to the `plain` sidecar
   * as `render`; that sidecar must have been built with its render dependencies, and
   * answers `WEB_PROVIDER_ERROR` (HTTP 501) if it was not, rather than quietly returning
   * an unrendered page. Ignored by the `firecrawl` dialect, which always renders.
   *
   * A per-site choice, not a default: rendering costs 0.5–3 s against ~50 ms static.
   */
  render?: boolean
  /** Cap on concurrent extractions. Constructor-time only. Defaults to {@link READABLE_DEFAULT_MAX_CONCURRENCY}. */
  maxConcurrency?: number
  /** Minimum gap between extraction starts in ms. Constructor-time only. Defaults to {@link READABLE_DEFAULT_MIN_INTERVAL_MS}. */
  minIntervalMs?: number
}

/** Options after defaults are applied. */
interface ResolvedReadableOptions {
  readonly baseURL: string
  readonly dialect: ReadableDialect
  readonly fetch: FetchLike
  readonly apiKey: string | undefined
  readonly headers: Record<string, string> | undefined
  readonly maxContentChars: number | undefined
  readonly render: boolean
  readonly operationPath: string
}

/* ── Response mapping ──────────────────────────────────────────────────────── */

/**
 * Map the plain sidecar's envelope to a normalized extraction.
 *
 * @param response - the parsed JSON body.
 * @param requestedUrl - the URL the caller asked for, used when the sidecar omits one.
 * @returns the normalized result; a missing body becomes an empty string, which the
 *   provider turns into a diagnosable error rather than an empty success.
 */
export function mapPlainExtractResponse(response: PlainExtractResponse, requestedUrl: string): WebExtractResult {
  return {
    url: response.url ?? requestedUrl,
    content: response.markdown ?? response.content ?? '',
    truncated: response.truncated ?? false,
  }
}

/**
 * Map Firecrawl's scrape envelope to a normalized extraction.
 *
 * @param response - the parsed JSON body.
 * @param requestedUrl - the URL the caller asked for, used when metadata omits one.
 * @returns the normalized result. Firecrawl reports no truncation flag, so `truncated`
 *   is `false` here and the `web_extract` tool's own cap is what flags it later.
 */
export function mapFirecrawlResponse(response: FirecrawlResponse, requestedUrl: string): WebExtractResult {
  const data = response.data ?? undefined
  return {
    url: data?.metadata?.sourceURL ?? data?.metadata?.url ?? requestedUrl,
    content: data?.markdown ?? data?.content ?? '',
    truncated: false,
  }
}

/**
 * The error to raise when the backend succeeded but produced no body.
 *
 * @param url - the page that yielded nothing.
 * @returns a message naming the plausible causes and the first thing to try, so the
 *   operator does not have to rediscover that a static extractor cannot read a
 *   client-rendered page.
 */
export function emptyExtractionMessage(url: string): string {
  return `the extraction backend returned no readable content for ${url}: the page may be client-rendered (retry with render: true, which loads it in headless Chromium), paywalled, or not an HTML document`
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/** The self-hosted readable-body extraction provider. */
export class ReadableExtractProvider implements WebSearchProvider {
  readonly id = READABLE_PROVIDER_ID

  private readonly gate: RequestGate

  /**
   * @param options - backend, dialect and rate limits. Endpoint and dialect fields are
   *   re-read for every operation; the rate-limit fields are read once, here.
   */
  constructor(private readonly options: OptionsSource<ReadableExtractOptions>) {
    const resolved = resolveSource(options)
    this.gate = new RequestGate(
      resolved.maxConcurrency ?? READABLE_DEFAULT_MAX_CONCURRENCY,
      resolved.minIntervalMs ?? READABLE_DEFAULT_MIN_INTERVAL_MS,
    )
  }

  /** True when the configured endpoint parses as an absolute URL. Deliberately offline. */
  available(): boolean {
    return isValidBaseUrl(this.resolve().baseURL)
  }

  /**
   * Never succeeds: this provider has no search capability.
   * @throws {@link WebError} `WEB_UNSUPPORTED_OPERATION`, naming the composition that works.
   */
  async search(_request: WebSearchRequest, _signal?: AbortSignal): Promise<WebSearchResult> {
    throw new WebError(
      `provider "${READABLE_PROVIDER_ID}" extracts pages; it does not search. Compose it after a search provider with fallbackSearchProvider() — the extract chain skips providers without an extract operation, so a chain of [searchProvider, readableExtractProvider] answers both capabilities.`,
      WEB_UNSUPPORTED_OPERATION,
    )
  }

  /**
   * Retrieve one page's readable body.
   * @param request - the URL to retrieve.
   * @param signal - cancellation signal, forwarded to `fetch`.
   * @returns the extracted body; `truncated` reflects the backend, not this side.
   * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_ERROR` when the
   *   backend failed or produced no readable body.
   */
  async extract(request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult> {
    const options = this.resolve()
    const release = await this.gate.acquire(signal)
    try {
      const result = options.dialect === 'firecrawl'
        ? await this.scrapeFirecrawl(options, request, signal)
        : await this.scrapePlain(options, request, signal)
      if (result.content.length === 0) {
        throw new WebError(emptyExtractionMessage(request.url), WEB_PROVIDER_ERROR)
      }
      return result
    } finally {
      release()
    }
  }

  /** POST the URL to the plain sidecar. */
  private async scrapePlain(
    options: ResolvedReadableOptions,
    request: WebExtractRequest,
    signal?: AbortSignal,
  ): Promise<WebExtractResult> {
    const response = await this.post(
      options,
      `${trimSlash(options.baseURL)}${options.operationPath}`,
      {
        url: request.url,
        ...options.maxContentChars !== undefined && isPositiveInteger(options.maxContentChars)
          ? { maxChars: options.maxContentChars }
          : {},
        // Only sent when asked for, so a sidecar built without its render dependencies
        // is never asked to render and an older sidecar that ignores the field still works.
        ...options.render ? { render: true } : {},
      },
      signal,
    )
    return mapPlainExtractResponse(await readJson<PlainExtractResponse>(response, signal), request.url)
  }

  /** POST the URL to Firecrawl's scrape operation. */
  private async scrapeFirecrawl(
    options: ResolvedReadableOptions,
    request: WebExtractRequest,
    signal?: AbortSignal,
  ): Promise<WebExtractResult> {
    const response = await this.post(
      options,
      `${trimSlash(options.baseURL)}${options.operationPath}`,
      { url: request.url, formats: ['markdown'] },
      signal,
    )
    const payload = await readJson<FirecrawlResponse>(response, signal)
    if (payload.success === false) {
      const detail = payload.error ?? 'no reason reported'
      throw new WebError(`Firecrawl refused to scrape ${request.url}: ${detail}`, WEB_PROVIDER_ERROR)
    }
    return mapFirecrawlResponse(payload, request.url)
  }

  /** One JSON POST, with credential-aware redirect policy and error classification. */
  private async post(
    options: ResolvedReadableOptions,
    endpoint: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const hasCredential = options.apiKey !== undefined
      || (options.headers !== undefined && Object.keys(options.headers).length > 0)
    let response: Response
    try {
      response = await options.fetch(endpoint, {
        method: 'POST',
        // A caller-supplied header may be a credential, so never let a redirect
        // carry it to another origin. Without one a redirect is harmless.
        redirect: hasCredential ? 'error' : 'follow',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
          ...options.apiKey !== undefined ? { 'authorization': `Bearer ${options.apiKey}` } : {},
          ...options.headers ?? {},
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw extractAborted(signal, error)
      throw new WebError(
        `extraction backend at ${options.baseURL} is unreachable: ${String(error)}`,
        WEB_PROVIDER_ERROR,
        { cause: error },
      )
    }
    if (!response.ok) {
      let detail: string | undefined
      try {
        const text = (await response.text()).trim()
        if (text.length > 0) detail = text.slice(0, 300)
      } catch (error: unknown) {
        if (isCancellation(error, signal)) throw extractAborted(signal, error)
        // The status below already carries the signal that matters.
      }
      const base = `extraction backend responded with HTTP ${response.status}`
      throw new WebError(detail === undefined ? base : `${base}: ${detail}`, WEB_PROVIDER_ERROR)
    }
    return response
  }

  /** Apply defaults to one operation's options. */
  private resolve(): ResolvedReadableOptions {
    const raw = resolveSource(this.options)
    const dialect = raw.dialect ?? 'plain'
    return {
      baseURL: raw.baseURL ?? (dialect === 'firecrawl' ? READABLE_DEFAULT_FIRECRAWL_BASE_URL : READABLE_DEFAULT_PLAIN_BASE_URL),
      dialect,
      fetch: raw.fetch ?? globalThis.fetch,
      apiKey: raw.apiKey,
      headers: raw.headers,
      maxContentChars: raw.maxContentChars,
      render: raw.render ?? false,
      operationPath: raw.operationPath
        ?? (dialect === 'firecrawl' ? READABLE_DEFAULT_SCRAPE_PATH : READABLE_DEFAULT_EXTRACT_PATH),
    }
  }
}

/** Build a readable-body extraction provider. */
export function readableExtractProvider(options: OptionsSource<ReadableExtractOptions>): ReadableExtractProvider {
  return new ReadableExtractProvider(options)
}

/** Strip trailing slashes so a path can be appended without doubling them. */
function trimSlash(baseURL: string): string {
  return baseURL.replace(/\/+$/, '')
}

/** Parse a JSON body, classifying a mid-body abort as cancellation. */
async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  try {
    return await response.json() as T
  } catch (error: unknown) {
    if (isCancellation(error, signal)) throw extractAborted(signal, error)
    throw new WebError(`extraction backend returned an unprocessable response body: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
  }
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function extractAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('page extraction aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
