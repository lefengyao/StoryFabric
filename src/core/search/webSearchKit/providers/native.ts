/**
 * Provider-native search: the vendor runs the search on its own servers because
 * the request declares a **server-side tool** (`web_search` on Anthropic Messages,
 * `web_search` on the OpenAI Responses API). Nothing about the search happens in
 * this process, and no third-party search API is involved.
 *
 * This is the cheapest and lowest-latency path when it is available, and the one
 * with the narrowest applicability:
 *
 * - **Availability is a property of the model route, not of this library.** A
 *   vendor exposes the tool on some endpoints and models and not others, so
 *   `available()` can only check local facts (key, endpoint, model). Deciding that
 *   *this* model supports native search is the caller's job — which is why the
 *   fallback provider exists.
 * - **Capabilities differ per vendor.** `max_uses`, domain filters, location, and
 *   context size are each supported by a different subset. The Anthropic adapter
 *   passes `max_uses` only; the Responses adapter passes no optional controls,
 *   because offering a control that may be silently dropped is worse than not
 *   offering it.
 * - **Billing differs.** Anthropic bills its server tool per search; token-billed
 *   routes (DeepSeek's Anthropic-compatible endpoint) fold it into the token
 *   count. `maxUses` multiplies the former.
 *
 * The Anthropic response mapping is shared with `DeepSeekSearchProvider`, which is
 * the specialized preset of this same protocol.
 * @module web-search-standalone/providers/native
 */

import { mapAnthropicResponse, type AnthropicResponse } from './deepseek'
import { dedupeSources, parseSearchText, sourcesFromValue } from './text-sources'
import { USER_AGENT, isCancellation, isPositiveInteger, resolveSource, type FetchLike, type OptionsSource } from './shared'
import {
  WEB_ABORTED,
  WEB_PROVIDER_CREDENTIAL_MISSING,
  WEB_PROVIDER_ERROR,
  WebError,
} from '../types'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '../types'

/** Default maximum server-side searches per request. */
export const NATIVE_DEFAULT_MAX_USES = 5

/** Default upper bound on generated tokens for the auxiliary request. */
export const NATIVE_DEFAULT_MAX_TOKENS = 4096

/** Anthropic server-tool version compatible with every Claude model. */
export const ANTHROPIC_WEB_SEARCH_VERSION = 'web_search_20250305'

/** Anthropic server-tool version adding dynamic filtering; needs newer models. */
export const ANTHROPIC_WEB_SEARCH_VERSION_DYNAMIC = 'web_search_20260209'

/** The exact outbound auxiliary request recorded immediately before dispatch. */
export interface NativeRequestRecord {
  /** Fully resolved request URL. */
  readonly endpoint: string
  /** Protocol adapter id (`anthropic-messages`, `openai-responses`, …). */
  readonly protocol: string
  /** Exact JSON body sent. */
  readonly body: unknown
}

/** Everything an adapter needs to build one request. */
export interface NativeProtocolContext {
  readonly model: string
  readonly query: string
  readonly apiKey: string
  readonly maxUses: number
  readonly maxTokens: number
  /** Include the auxiliary model's prose as `content`. Defaults to false. */
  readonly includeAnswer: boolean
}

/** One vendor protocol: how to ask, and how to read the answer. */
export interface NativeProtocolAdapter {
  /** Stable id, reported in {@link NativeRequestRecord}. */
  readonly id: string
  /**
   * Build the request.
   * @param context - resolved model, query, credential, and limits.
   * @returns headers and body.
   */
  buildRequest(context: NativeProtocolContext): { headers: Record<string, string>; body: unknown }
  /**
   * Map the response body to a normalized result.
   * @param body - the parsed response body.
   * @param context - the same context the request was built from.
   * @returns the normalized result.
   */
  parseResponse(body: unknown, context: NativeProtocolContext): WebSearchResult
}

/* ── Anthropic Messages ────────────────────────────────────────────────────── */

/** Options for {@link anthropicMessagesAdapter}. */
export interface AnthropicMessagesAdapterOptions {
  /**
   * Server-tool version. Defaults to {@link ANTHROPIC_WEB_SEARCH_VERSION}, the
   * revision every Claude model accepts; the dynamic-filtering revision needs
   * newer models.
   */
  readonly version?: string
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  readonly apiVersion?: string
  /** Instruction text sent as the user turn. */
  readonly prompt?: (query: string) => string
}

/**
 * The Anthropic Messages protocol with the native `web_search` server tool. Also
 * serves Anthropic-compatible gateways (DeepSeek, Z.ai, BigModel) that proxy it.
 *
 * @param options - tool version, API version, and prompt override.
 * @returns the adapter.
 */
export function anthropicMessagesAdapter(options: AnthropicMessagesAdapterOptions = {}): NativeProtocolAdapter {
  const version = options.version ?? ANTHROPIC_WEB_SEARCH_VERSION
  const apiVersion = options.apiVersion ?? '2023-06-01'
  const prompt = options.prompt ?? ((query: string) => `Perform a web search for the query: ${query}`)
  return {
    id: 'anthropic-messages',
    buildRequest(context) {
      return {
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          // Official Anthropic expects `x-api-key`; compatible gateways may expect
          // `Authorization: Bearer`. Sending both lets either resolve.
          'x-api-key': context.apiKey,
          'authorization': `Bearer ${context.apiKey}`,
          'anthropic-version': apiVersion,
          'user-agent': USER_AGENT,
        },
        body: {
          model: context.model,
          max_tokens: context.maxTokens,
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: prompt(context.query) }],
          }],
          tools: [{ type: version, name: 'web_search', max_uses: context.maxUses }],
        },
      }
    },
    parseResponse(body) {
      // `mapAnthropicResponse` throws when no `web_search_tool_result` block came
      // back, which is the loud failure this path wants: a route that silently
      // ignores the tool must not look like a search that found nothing.
      return mapAnthropicResponse(body as AnthropicResponse)
    },
  }
}

/* ── OpenAI Responses ──────────────────────────────────────────────────────── */

/** Options for {@link openaiResponsesAdapter}. */
export interface OpenAIResponsesAdapterOptions {
  /** Server tool type. Defaults to `web_search`. */
  readonly toolType?: string
  /** Instruction text sent as the input. */
  readonly prompt?: (query: string) => string
}

/** Narrow a value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read `output[].content[].annotations[]` citations from a Responses payload. Each
 * `url_citation` names a span of the answer text, and that span is the excerpt —
 * the same citation-to-snippet join the Anthropic path performs.
 */
function responsesCitations(body: unknown): { sources: WebSearchSource[]; text: string } {
  const sources: WebSearchSource[] = []
  const texts: string[] = []
  const output = isRecord(body) ? body.output : undefined
  if (!Array.isArray(output)) return { sources, text: '' }

  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message') continue
    const content = item.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!isRecord(part)) continue
      const text = typeof part.text === 'string' ? part.text : undefined
      if (text !== undefined && text.length > 0) texts.push(text)
      const annotations = part.annotations
      if (!Array.isArray(annotations)) continue
      for (const annotation of annotations) {
        if (!isRecord(annotation) || annotation.type !== 'url_citation') continue
        const url = typeof annotation.url === 'string' ? annotation.url : undefined
        if (url === undefined || url.length === 0) continue
        const title = typeof annotation.title === 'string' && annotation.title.length > 0 ? annotation.title : undefined
        const snippet = text !== undefined
          && typeof annotation.start_index === 'number'
          && typeof annotation.end_index === 'number'
          && annotation.end_index > annotation.start_index
          ? text.slice(annotation.start_index, annotation.end_index).trim()
          : undefined
        sources.push({
          url,
          ...title !== undefined ? { title } : {},
          ...snippet !== undefined && snippet.length > 0 ? { snippet } : {},
        })
      }
    }
  }
  return { sources, text: texts.join('\n\n').trim() }
}

/**
 * The OpenAI Responses protocol with the native `web_search` server tool. Works
 * with OpenAI and with gateways that pass the tool through.
 *
 * `tool_choice` is deliberately left unset: several OpenAI-compatible gateways
 * reject a forced tool choice for server-side tools, and a single-tool request
 * plus its instruction already makes the search the obvious action.
 *
 * @param options - server-tool type and prompt override.
 * @returns the adapter.
 */
export function openaiResponsesAdapter(options: OpenAIResponsesAdapterOptions = {}): NativeProtocolAdapter {
  const toolType = options.toolType ?? 'web_search'
  const prompt = options.prompt ?? ((query: string) => `Perform a web search for the query: ${query}`)
  return {
    id: 'openai-responses',
    buildRequest(context) {
      return {
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'authorization': `Bearer ${context.apiKey}`,
          'user-agent': USER_AGENT,
        },
        body: {
          model: context.model,
          input: prompt(context.query),
          tools: [{ type: toolType }],
        },
      }
    },
    parseResponse(body, context) {
      const answer = responsesCitations(body)
      const cited = dedupeSources(answer.sources)
      const withAnswer = (result: WebSearchResult): WebSearchResult =>
        context.includeAnswer && answer.text.length > 0 ? { ...result, content: answer.text } : result
      if (cited.length > 0) return withAnswer({ sources: cited, truncated: false })

      // No annotations: the links may still be in the answer text. Reuse the
      // shared extraction before scanning the raw payload for url-bearing objects.
      if (answer.text.length > 0) {
        const fromText = parseSearchText(answer.text)
        if (fromText.sources.length > 0) return withAnswer(fromText)
      }
      const generic = dedupeSources(sourcesFromValue(body))
      if (generic.length > 0) return withAnswer({ sources: generic, truncated: false })

      throw new WebError(
        'the provider returned no search result; the route may not honour the native search tool',
        WEB_PROVIDER_ERROR,
      )
    },
  }
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/** Provider options; every field has a documented default. */
export interface NativeSearchProviderOptions {
  /**
   * Protocol: a shipped id, or an adapter built by
   * {@link anthropicMessagesAdapter} / {@link openaiResponsesAdapter}.
   */
  readonly protocol: NativeProtocolAdapter | 'anthropic-messages' | 'openai-responses'
  /** Full request URL. The adapter never appends a path. */
  readonly endpoint: string
  /** Model name sent on the auxiliary request. */
  readonly model: string
  /** Literal key; when present it wins over {@link resolveApiKey}. */
  readonly apiKey?: string
  /** Resolve the key for one operation. */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named in missing-credential diagnostics. */
  readonly apiKeyRef?: string
  /** Maximum server-side searches per request. Defaults to 5. */
  readonly maxUses?: number
  /** Upper bound on generated tokens. Defaults to 4096. */
  readonly maxTokens?: number
  /** Extra request headers (gateway routing, organization, …). */
  readonly extraHeaders?: Record<string, string>
  /** Include the auxiliary model's prose as `content`. Defaults to false. */
  readonly includeAnswer?: boolean
  /** HTTP client; defaults to the global `fetch`. */
  readonly fetch?: FetchLike
  /** Record the exact outbound request before dispatch; a throw prevents dispatch. */
  readonly onRequest?: (record: NativeRequestRecord) => void
}

/** Options after defaults are applied. */
interface ResolvedNativeOptions {
  readonly protocol: NativeProtocolAdapter
  readonly endpoint: string
  readonly model: string
  readonly apiKey: string | undefined
  readonly resolveApiKey: (() => Promise<string | undefined>) | undefined
  readonly apiKeyRef: string
  readonly maxUses: number
  readonly maxTokens: number
  readonly extraHeaders: Record<string, string>
  readonly includeAnswer: boolean
  readonly fetch: FetchLike
  readonly record: ((record: NativeRequestRecord) => void) | undefined
}

/** Resolve a protocol reference to an adapter. */
export function resolveNativeProtocol(protocol: NativeSearchProviderOptions['protocol']): NativeProtocolAdapter {
  if (typeof protocol !== 'string') return protocol
  if (protocol === 'anthropic-messages') return anthropicMessagesAdapter()
  if (protocol === 'openai-responses') return openaiResponsesAdapter()
  throw new Error(
    `unknown native search protocol "${protocol}"; use "anthropic-messages" or "openai-responses", or pass an adapter`,
  )
}

/**
 * The provider-native search provider: one auxiliary model request carrying the
 * vendor's own server-side search tool.
 *
 * `available()` reports only local facts. Whether the *model route* honours the
 * server tool cannot be known without calling it, so a caller that wants native
 * search when possible and a fallback otherwise composes this provider with a
 * fallback provider.
 */
export class NativeSearchProvider implements WebSearchProvider {
  readonly id: string

  /**
   * @param source - the options, or a thunk returning them so a host can swap the
   *   active model, endpoint, or key between calls without re-registering. The
   *   protocol id is read once at construction, because it is part of the
   *   registration key.
   */
  constructor(private readonly source: OptionsSource<NativeSearchProviderOptions>) {
    this.id = `native-${resolveNativeProtocol(resolveSource(source).protocol).id}`
  }

  /** True when a key source, a parseable endpoint, a model name, and valid limits are configured. */
  available(): boolean {
    const options = this.resolve()
    return (options.apiKey !== undefined && options.apiKey.length > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.endpoint)
      && options.model.length > 0
      && isPositiveInteger(options.maxUses)
      && isPositiveInteger(options.maxTokens)
  }

  /**
   * Run one search through the vendor's own search tool.
   * @param request - the query; `maxResults` is enforced by the runtime, since the
   *   server tool exposes no result-count control.
   * @param signal - cancellation signal forwarded to `fetch`.
   * @returns the normalized result.
   * @throws {@link WebError} `WEB_ABORTED`, `WEB_PROVIDER_CREDENTIAL_MISSING`, or
   *   `WEB_PROVIDER_ERROR` — including when the route silently ignored the tool.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolve()
    const apiKey = await this.apiKey(options, signal)
    throwIfAborted(signal)
    const context: NativeProtocolContext = {
      model: options.model,
      query: request.query,
      apiKey,
      maxUses: options.maxUses,
      maxTokens: options.maxTokens,
      includeAnswer: options.includeAnswer,
    }
    const { headers, body } = options.protocol.buildRequest(context)
    options.record?.({ endpoint: options.endpoint, protocol: options.protocol.id, body })
    throwIfAborted(signal)

    let response: Response
    try {
      response = await options.fetch(options.endpoint, {
        method: 'POST',
        // The request carries the vendor credential; never follow a redirect.
        redirect: 'error',
        headers: { ...headers, ...options.extraHeaders },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw nativeAborted(error, signal)
      throw new WebError(`native search request failed: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }

    if (!response.ok) {
      const detail = await safeBody(response)
      throw new WebError(
        `${options.endpoint} responded HTTP ${response.status}${detail.length > 0 ? `: ${detail}` : ''}`,
        WEB_PROVIDER_ERROR,
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw nativeAborted(error, signal)
      throw new WebError(`native search returned an unprocessable body: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }
    try {
      return options.protocol.parseResponse(payload, context)
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw nativeAborted(error, signal)
      if (error instanceof WebError) throw error
      throw new WebError(`native search response could not be read: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }
  }

  /** Apply defaults to one operation's options. */
  private resolve(): ResolvedNativeOptions {
    const raw = resolveSource(this.source)
    return {
      protocol: resolveNativeProtocol(raw.protocol),
      endpoint: raw.endpoint,
      model: raw.model,
      apiKey: raw.apiKey,
      resolveApiKey: raw.resolveApiKey,
      apiKeyRef: raw.apiKeyRef ?? 'the provider key',
      maxUses: raw.maxUses ?? NATIVE_DEFAULT_MAX_USES,
      maxTokens: raw.maxTokens ?? NATIVE_DEFAULT_MAX_TOKENS,
      extraHeaders: raw.extraHeaders ?? {},
      includeAnswer: raw.includeAnswer ?? false,
      fetch: raw.fetch ?? globalThis.fetch,
      record: raw.onRequest,
    }
  }

  /** Resolve the credential for one operation. */
  private async apiKey(options: ResolvedNativeOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.()
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw nativeAborted(error, signal)
      throw new WebError(`credential resolution failed: ${String(error)}`, WEB_PROVIDER_ERROR, { cause: error })
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `native search has no API key for "${options.apiKeyRef}";`
      + ' supply it through the apiKey option or return it from resolveApiKey.',
      WEB_PROVIDER_CREDENTIAL_MISSING,
    )
  }
}

/** Build a provider-native search provider. */
export function nativeSearchProvider(options: OptionsSource<NativeSearchProviderOptions>): NativeSearchProvider {
  return new NativeSearchProvider(options)
}

/** Read a bounded error body for diagnostics. */
async function safeBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.trim().slice(0, 500)
  } catch {
    // A body that cannot be read only costs a richer message; the status stands.
    return ''
  }
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function nativeAborted(fallback?: unknown, signal?: AbortSignal): WebError {
  return new WebError('native search aborted', WEB_ABORTED, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** Throw when the caller already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw nativeAborted(signal, signal)
}
