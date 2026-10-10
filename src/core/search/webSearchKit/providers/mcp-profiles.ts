/**
 * Server profiles for MCP-backed search. Every profile is one MCP endpoint plus
 * the three facts that differ between vendors: the tool names, the argument
 * names, and whether a credential is required.
 *
 * The endpoints shipped here are public hosted MCP servers, not vendor-specific
 * code paths: naming a profile is an explicit choice, and swapping profiles is a
 * configuration change. Anysearch, Exa, and Parallel all speak the same
 * `tools/call` JSON-RPC, which is why one provider class covers all three.
 * @module web-search-standalone/providers/mcp-profiles
 */

import type { WebSearchRequest } from '../types'

/** Bounds the profile applies when building wire arguments. */
export interface McpSearchLimits {
  /** Result cap to request from the server. */
  readonly maxResults: number
}

/** How a profile's endpoint authenticates, when it can. */
export interface McpAuthSpec {
  /** Header to set, lower-case. */
  readonly header: string
  /** Authorization scheme prefix, e.g. `Bearer`. Omitted = the raw key is the value. */
  readonly scheme?: string
  /** Credential reference named in missing-credential diagnostics and resolved by the caller. */
  readonly ref: string
  /**
   * True when the endpoint is unusable without a key. Defaults to false: the
   * hosted endpoints here also serve anonymous, quota-limited traffic.
   */
  readonly required?: boolean
}

/** One MCP search server. */
export interface McpSearchProfile {
  /** Stable id, used as the provider id unless overridden. */
  readonly id: string
  /** JSON-RPC endpoint. */
  readonly endpoint: string
  /** Credential, when the profile can use one. */
  readonly auth?: McpAuthSpec
  /** MCP tool names on this server. */
  readonly tools: {
    readonly search: string
    /** Absent = the server has no batch operation, so the consumer fans out. */
    readonly batch?: string
    /** Absent = the server cannot extract page bodies. */
    readonly extract?: string
  }
  /** Map one normalized request onto this server's argument names. */
  readonly buildSearchArgs: (request: WebSearchRequest, limits: McpSearchLimits) => Record<string, unknown>
  /** Map several requests onto this server's batch argument names. */
  readonly buildBatchArgs?: (requests: readonly WebSearchRequest[], limits: McpSearchLimits) => Record<string, unknown>
  /** Map one URL onto this server's extract argument names. */
  readonly buildExtractArgs?: (url: string) => Record<string, unknown>
}

/**
 * Anysearch: general web search with recency and content-type filters, batch
 * search, and Markdown body extraction. The API key is optional — anonymous
 * access works with a lower, less stable quota.
 */
export const ANYSEARCH_PROFILE: McpSearchProfile = {
  id: 'anysearch',
  endpoint: 'https://api.anysearch.com/mcp',
  auth: { header: 'authorization', scheme: 'Bearer', ref: 'ANYSEARCH_API_KEY' },
  tools: { search: 'search', batch: 'batch_search', extract: 'extract' },
  buildSearchArgs: (request, limits) => ({
    query: request.query,
    max_results: limits.maxResults,
  }),
  buildBatchArgs: (requests, limits) => ({
    queries: requests.map(request => ({ query: request.query, max_results: limits.maxResults })),
  }),
  buildExtractArgs: url => ({ url }),
}

/**
 * Exa's hosted MCP. Reaches Exa's own index through the same transport opencode
 * uses. Search only — no batch tool, no extract tool.
 */
export const EXA_MCP_PROFILE: McpSearchProfile = {
  id: 'exa-mcp',
  endpoint: 'https://mcp.exa.ai/mcp',
  auth: { header: 'authorization', scheme: 'Bearer', ref: 'EXA_API_KEY' },
  tools: { search: 'web_search_exa' },
  buildSearchArgs: (request, limits) => ({
    query: request.query,
    type: 'auto',
    numResults: limits.maxResults,
    livecrawl: 'fallback',
  }),
}

/**
 * Parallel's hosted MCP. Its search tool takes an objective plus a query list,
 * so the single-query mapping passes the query as both.
 */
export const PARALLEL_MCP_PROFILE: McpSearchProfile = {
  id: 'parallel-mcp',
  endpoint: 'https://search.parallel.ai/mcp',
  auth: { header: 'authorization', scheme: 'Bearer', ref: 'PARALLEL_API_KEY' },
  tools: { search: 'web_search' },
  buildSearchArgs: request => ({
    objective: request.query,
    search_queries: [request.query],
  }),
}

/** The shipped profiles, keyed by id. */
export const MCP_PROFILES: Readonly<Record<string, McpSearchProfile>> = {
  [ANYSEARCH_PROFILE.id]: ANYSEARCH_PROFILE,
  [EXA_MCP_PROFILE.id]: EXA_MCP_PROFILE,
  [PARALLEL_MCP_PROFILE.id]: PARALLEL_MCP_PROFILE,
}

/** A profile object, or the id of one of the shipped profiles. */
export type McpProfileRef = McpSearchProfile | keyof typeof MCP_PROFILES | string

/**
 * Resolve a profile reference.
 * @param profile - a full profile, or the id of a shipped profile.
 * @returns the profile.
 * @throws {Error} when an id names no shipped profile — a typo must not silently
 *   fall back to a different vendor.
 */
export function resolveProfile(profile: McpProfileRef): McpSearchProfile {
  if (typeof profile !== 'string') return profile
  const found = MCP_PROFILES[profile]
  if (found === undefined) {
    throw new Error(`unknown MCP search profile "${profile}"; shipped profiles: ${Object.keys(MCP_PROFILES).join(', ')}`)
  }
  return found
}
