/**
 * Search-provider registry and execution-time selection. Ported from DeepSeek
 * Harness `packages/web/web/src/index.ts` with the Cordis `Service` base class
 * and the fetch half removed: providers register into a plain `Map`, and the
 * disposer returned by a registration is an ordinary function.
 *
 * One registry serves both operations (search and extract) so provider
 * selection, cancellation, and the error vocabulary have one owner.
 * @module web-search-standalone/runtime
 */

import {
  WEB_DUPLICATE_PROVIDER,
  WEB_PROVIDER_AMBIGUOUS,
  WEB_PROVIDER_CONFIGURED_MISSING,
  WEB_PROVIDER_CONFIGURED_UNAVAILABLE,
  WEB_PROVIDER_UNAVAILABLE,
  WEB_UNSUPPORTED_OPERATION,
  WebError,
} from './types'
import type {
  WebExtractRequest,
  WebExtractResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types'

/**
 * How the runtime picks a provider id. A function is re-read on every call, which
 * is what lets a host route by the *currently active chat model* — native search
 * when that model's route supports it, an MCP backend otherwise.
 */
export type ProviderSelector = string | (() => string | undefined)

/** Runtime configuration: the provider-selection policy owner. */
export interface WebSearchRuntimeConfig {
  /**
   * Explicit search provider id, or a resolver read per call. Omitted =
   * auto-select when exactly one provider is usable.
   */
  readonly searchProvider?: ProviderSelector
}

/** The capability a consumer needs. `WebSearchRuntime` is the shipped implementation. */
export interface SearchRunner {
  /**
   * Run one search through the selected provider.
   * @param request - the query and optional result cap.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's result, capped to `request.maxResults`.
   */
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
  /**
   * Run several searches in one backend round trip when the selected provider
   * supports it.
   * @param requests - the queries, each with its own optional result cap.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns index-aligned results, or `undefined` when the provider cannot batch
   *   (the consumer then falls back to concurrent single searches).
   */
  batchSearch?(requests: readonly WebSearchRequest[], signal?: AbortSignal): Promise<readonly WebSearchResult[] | undefined>
  /**
   * Retrieve one page's readable body through the selected provider.
   * @param request - the URL to retrieve.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the extraction outcome.
   */
  extract?(request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult>
}

/**
 * Registers search providers and resolves one at execution time.
 *
 * Selection semantics (never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebSearchRuntime implements SearchRunner {
  private readonly providers = new Map<string, WebSearchProvider>()
  private readonly selector: ProviderSelector | undefined

  /**
   * @param config - the selection policy; `searchProvider` pins one provider id or
   *   supplies a resolver read on every call.
   */
  constructor(config: WebSearchRuntimeConfig = {}) {
    this.selector = config.searchProvider
  }

  /** Registered provider ids, in registration order. */
  get providerIds(): readonly string[] {
    return [...this.providers.keys()]
  }

  /**
   * Register a search provider.
   * @param provider - the provider; its `id` is the registry key.
   * @returns a disposer that unregisters this exact provider. Unlike the harness
   *   original, a stale disposer cannot remove a later provider that reused the
   *   id, because removal is identity-checked.
   * @throws {@link WebError} `WEB_DUPLICATE_PROVIDER` when the id is already registered.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new WebError(`a web search provider with id "${provider.id}" is already registered`, WEB_DUPLICATE_PROVIDER)
    }
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  /**
   * Run one search through the selected provider.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   * @throws {@link WebError} when the capability cannot run (selection failures).
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const provider = this.resolveProvider()
    const result = await provider.search(request, signal)
    return capSources(result, request.maxResults)
  }

  /**
   * Run several searches in one round trip when the selected provider can.
   * @param requests - the queries, each with its own optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns index-aligned capped results, or `undefined` when unsupported.
   * @throws {@link WebError} when the capability cannot run (selection failures).
   */
  async batchSearch(
    requests: readonly WebSearchRequest[],
    signal?: AbortSignal,
  ): Promise<readonly WebSearchResult[] | undefined> {
    const provider = this.resolveProvider()
    if (provider.batchSearch === undefined) return undefined
    const results = await provider.batchSearch(requests, signal)
    if (results === undefined) return undefined
    return results.map((result, index) => capSources(result, requests[index]?.maxResults))
  }

  /**
   * Retrieve one page through the selected provider.
   * @param request - the URL to retrieve.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the extraction outcome.
   * @throws {@link WebError} `WEB_UNSUPPORTED_OPERATION` when the selected
   *   provider has no extraction operation, or a selection error.
   */
  async extract(request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult> {
    const provider = this.resolveProvider()
    if (provider.extract === undefined) {
      throw new WebError(`web search provider "${provider.id}" does not support extraction`, WEB_UNSUPPORTED_OPERATION)
    }
    return provider.extract(request, signal)
  }

  /** Resolve the selected provider or throw the matching {@link WebError}. */
  private resolveProvider(): WebSearchProvider {
    // A resolver is re-read on every call, so a host can route by the active model.
    const configuredId = typeof this.selector === 'function' ? this.selector() : this.selector
    if (configuredId !== undefined) {
      const provider = this.providers.get(configuredId)
      if (provider === undefined) {
        throw new WebError(`configured web search provider "${configuredId}" is not registered`, WEB_PROVIDER_CONFIGURED_MISSING)
      }
      if (!provider.available()) {
        throw new WebError(`configured web search provider "${configuredId}" is registered but unavailable`, WEB_PROVIDER_CONFIGURED_UNAVAILABLE)
      }
      return provider
    }
    const usable = [...this.providers.values()].filter(provider => provider.available())
    const [single] = usable
    if (single === undefined) {
      throw new WebError('no usable web search provider is registered', WEB_PROVIDER_UNAVAILABLE)
    }
    if (usable.length > 1) {
      const ids = usable.map(provider => provider.id).join(', ')
      throw new WebError(`multiple usable web search providers are registered (${ids}); configure one explicitly`, WEB_PROVIDER_AMBIGUOUS)
    }
    return single
  }
}

/** Enforce `maxResults` on a result: truncate `sources[]` and flag it. */
export function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}
