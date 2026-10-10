/**
 * Ordered failover across providers — the "use the model vendor's own search tool
 * when it works, otherwise use the MCP backend" composition.
 *
 * Failover is deliberately **selective**. Retrying the next backend makes sense for
 * "this route does not have the capability" and "this backend is down"; it makes
 * none for a cancelled call, a malformed argument, or a caller mistake. Each
 * attempted provider is reported in the final error, so a silent quality change
 * (native results replaced by MCP results) is never invisible.
 * @module web-search-standalone/providers/fallback
 */

import {
  INVALID_ARGS,
  TOOL_TIMEOUT,
  WEB_ABORTED,
  WEB_PROVIDER_ERROR,
  WebError,
} from '../types'
import type {
  WebExtractRequest,
  WebExtractResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../types'

/**
 * Codes that end the chain instead of trying the next provider.
 *
 * - `WEB_ABORTED`: the caller cancelled; spending another backend's quota is wrong.
 * - `INVALID_ARGS`: no backend can fix a malformed request.
 * - `TOOL_TIMEOUT`: the deadline belongs to the whole call, so the next attempt
 *   would start with an already-expired budget.
 */
export const NON_FAILOVER_CODES: readonly string[] = [WEB_ABORTED, INVALID_ARGS, TOOL_TIMEOUT]

/** Options for {@link fallbackSearchProvider}. */
export interface FallbackSearchProviderOptions {
  /** Registered provider id. Defaults to `fallback`. */
  readonly id?: string
  /** Providers in preference order. Unusable ones are skipped. */
  readonly providers: readonly WebSearchProvider[]
  /** Additional error codes that end the chain. Merged with {@link NON_FAILOVER_CODES}. */
  readonly stopOn?: readonly string[]
}

/** One attempted provider, for the failure report. */
interface Attempt {
  readonly id: string
  readonly code: string
  readonly message: string
}

/** True when the chain should stop rather than try the next provider. */
function stopsChain(error: unknown, stopOn: readonly string[]): boolean {
  return error instanceof WebError && stopOn.includes(error.code)
}

/** Render the attempts as one diagnosable message. */
function chainFailure(attempts: readonly Attempt[]): WebError {
  const detail = attempts.map(attempt => `  ${attempt.id}: [${attempt.code}] ${attempt.message}`).join('\n')
  return new WebError(
    `every configured web search provider failed:\n${detail}`,
    WEB_PROVIDER_ERROR,
    { cause: attempts[attempts.length - 1] === undefined ? undefined : new Error(attempts[attempts.length - 1]?.message ?? '') },
  )
}

/**
 * Compose providers into one that tries each in order.
 *
 * The id is stable (`fallback` by default), so provider selection at the runtime
 * level never has to know how many backends sit behind it. Which backend actually
 * served a call is visible through each provider's own `onRequest` hook.
 *
 * @param options - the providers in preference order, plus optional overrides.
 * @returns the composed provider.
 */
export function fallbackSearchProvider(options: FallbackSearchProviderOptions): WebSearchProvider {
  const stopOn = [...NON_FAILOVER_CODES, ...options.stopOn ?? []]
  const usable = (): WebSearchProvider[] => options.providers.filter(provider => provider.available())

  const composed: WebSearchProvider = {
    id: options.id ?? 'fallback',

    /** Usable when at least one provider is. */
    available: () => usable().length > 0,

    async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
      const candidates = usable()
      if (candidates.length === 0) {
        throw new WebError('no usable web search provider is registered', WEB_PROVIDER_ERROR)
      }
      const attempts: Attempt[] = []
      for (const provider of candidates) {
        try {
          return await provider.search(request, signal)
        } catch (error: unknown) {
          if (stopsChain(error, stopOn)) throw error
          attempts.push({
            id: provider.id,
            code: error instanceof WebError ? error.code : 'UNKNOWN',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      throw chainFailure(attempts)
    },
  }

  // Batching is only offered when some usable provider implements it, and a failed
  // batch returns `undefined` so the consumer fans out through `search`, which
  // walks the same failover chain.
  if (options.providers.some(provider => provider.batchSearch !== undefined)) {
    composed.batchSearch = async (requests, signal) => {
      for (const provider of usable()) {
        if (provider.batchSearch === undefined) continue
        try {
          return await provider.batchSearch(requests, signal)
        } catch (error: unknown) {
          if (stopsChain(error, stopOn)) throw error
          return undefined
        }
      }
      return undefined
    }
  }

  if (options.providers.some(provider => provider.extract !== undefined)) {
    composed.extract = async (request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult> => {
      const attempts: Attempt[] = []
      for (const provider of usable()) {
        if (provider.extract === undefined) continue
        try {
          return await provider.extract(request, signal)
        } catch (error: unknown) {
          if (stopsChain(error, stopOn)) throw error
          attempts.push({
            id: provider.id,
            code: error instanceof WebError ? error.code : 'UNKNOWN',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      throw chainFailure(attempts)
    }
  }

  return composed
}
