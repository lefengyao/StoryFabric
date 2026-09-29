/**
 * Where a search capability comes from, and how to choose between the places.
 *
 * A deployed assistant has up to three sources of web search, and they are not
 * interchangeable — they differ in cost, latency, and who can see the query:
 *
 * | tier | who runs the search | needs | cost |
 * |---|---|---|---|
 * | `native` | the model vendor's own servers | a capable model route | included in the model call; your process never sees the traffic |
 * | `free` | a free hosted service | nothing | free, third-party, rate-limited |
 * | `self-hosted` | your own deployment | a server (see `selfhosted/`) | your infrastructure; nobody else sees the query |
 *
 * This module turns that into configuration rather than wiring code, because the
 * decision has two halves that are easy to get wrong by hand:
 *
 * 1. **Routing** — is this model's route even capable of native search? Sending a doomed
 *    request is not free: it costs a round trip and, worse, some vendors *silently ignore*
 *    an unknown tool and answer without searching. Known-incapable routes should skip the
 *    native tier rather than fail through it.
 * 2. **Failover** — the route claimed capability and the call still failed. Then the next
 *    tier runs, with the whole chain reported on total failure.
 *
 * The two are separate mechanisms: routing picks *where the chain starts*, failover walks
 * the rest of it. Both are handled here, so a host that knows its active model gets the
 * right behaviour with one call.
 *
 * ```ts
 * const deployment = createDeployment({
 *   activeModel: () => agent.activeModel,
 *   native: { endpoint: 'https://api.anthropic.com/v1/messages', apiKey: process.env.ANTHROPIC_API_KEY },
 *   free: { profile: 'anysearch' },
 *   selfHosted: { baseURL: 'https://search.example.com', token: process.env.SEARCH_TOKEN },
 * })
 * deployment.register(runtime)
 * // and where the runtime wants an id:
 * const runtime = new WebSearchRuntime({ searchProvider: () => deployment.searchProviderFor(agent.activeModel) })
 * ```
 *
 * **Availability of the native tier cannot be detected locally.** Whether a vendor exposes
 * its server-side search tool depends on the endpoint, the model, and the account's plan.
 * The shipped {@link NATIVE_SEARCH_FAMILIES} table is a deliberately small, conservative
 * default; override it with `families` or set `capability` explicitly when you know better.
 * @module web-search-standalone/deployment
 */

import { INVALID_ARGS, WEB_ABORTED, WEB_PROVIDER_CREDENTIAL_MISSING, WebError } from './types'
import type { WebExtractRequest, WebExtractResult, WebSearchProvider, WebSearchRequest, WebSearchResult } from './types'
import { fallbackSearchProvider } from './providers/fallback'
import { mcpSearchProvider, type McpSearchProviderOptions } from './providers/mcp'
import type { McpProfileRef } from './providers/mcp-profiles'
import { nativeSearchProvider } from './providers/native'
import { webContentProvider, type WebContentMode } from './providers/webcontent'
import type { FetchLike } from './providers/shared'
import type { WebSearchRuntime } from './runtime'

/** The three places a search capability can come from. */
export type TierId = 'native' | 'free' | 'self-hosted'

/** Preference order used when the caller does not specify one. */
export const DEFAULT_TIER_ORDER: readonly TierId[] = ['native', 'free', 'self-hosted']

/**
 * A named preference order, for a host that knows what it optimises for rather than which
 * tier should win. Each one is a stated trade-off, not a ranking.
 */
export type TierPreset = 'native-first' | 'privacy-first' | 'cost-first'

/**
 * What each preset means, and why the order is what it is.
 *
 * The three tiers do not differ only in speed. Who ends up able to see the query changes
 * with each one, and so does what a search costs at the margin — so "which should go first"
 * has three defensible answers depending on what the deployment cares about.
 */
export const TIER_PRESETS: Readonly<Record<TierPreset, readonly TierId[]>> = {
  /**
   * The default. The vendor's own search costs one hop and no new party: the vendor already
   * has the prompt, and the search happens on its side of the wire.
   */
  'native-first': ['native', 'free', 'self-hosted'],
  /**
   * Nothing new learns the query. Your own server discloses it to nobody; the vendor already
   * has the prompt, so its server-side search adds no new party; a hosted free tier is an
   * additional third party that would otherwise see nothing at all.
   *
   * Note that this is about *new* parties, not about avoidance: if the query is sensitive to
   * the model vendor too, no tier helps — that is what a local model is for.
   */
  'privacy-first': ['self-hosted', 'native', 'free'],
  /**
   * Marginal cost per search. Infrastructure you already pay for is free at the margin; a
   * free hosted tier is free but quota-limited; a vendor's server tool is metered, since
   * vendors bill server-side searches (Anthropic bills per search, token-billed routes fold
   * it into the token count).
   */
  'cost-first': ['self-hosted', 'free', 'native'],
}

/** The tier ids, for validation. */
const TIER_IDS: readonly TierId[] = ['native', 'free', 'self-hosted']

/**
 * Expand an `order` into a tier list and whether it was stated explicitly.
 *
 * The distinction matters: a preset or the default expresses a *preference*, so tiers that
 * are simply not configured are filtered away. An explicit array is a complete statement of
 * intent, so naming a tier that is not configured is a mistake worth reporting.
 *
 * @param order - a preset name, an explicit tier list, or undefined for the default.
 * @returns the tiers and whether the caller stated them explicitly.
 * @throws Error when a preset name is unknown.
 */
export function resolveTierOrder(order: readonly TierId[] | TierPreset | undefined): { tiers: readonly TierId[]; explicit: boolean } {
  if (order === undefined) return { tiers: DEFAULT_TIER_ORDER, explicit: false }
  if (Array.isArray(order)) {
    for (const tier of order) {
      // Typed callers cannot reach this, but a config file or an env var arrives untyped.
      if (!TIER_IDS.includes(tier)) {
        throw new Error(`unknown tier ${JSON.stringify(tier)} in \`order\`; known tiers: ${TIER_IDS.join(', ')}`)
      }
    }
    return { tiers: order, explicit: true }
  }
  const preset = TIER_PRESETS[order as TierPreset]
  if (preset === undefined) {
    // TypeScript catches this for typed callers, but a config file arrives untyped.
    throw new Error(
      `unknown deployment order ${JSON.stringify(order)}; `
      + `use one of ${Object.keys(TIER_PRESETS).join(', ')} or an explicit array of tier ids`,
    )
  }
  return { tiers: preset, explicit: false }
}

/** The two protocols this package can use to declare a vendor's server-side search tool. */
export type NativeProtocolName = 'anthropic-messages' | 'openai-responses'

/**
 * Model families whose vendor runs search server-side, and the protocol that declares it.
 *
 * Deliberately small. Two things are true at once and only one of them is knowable here:
 *
 * - The protocol each family speaks *is* knowable, because this package implements the
 *   adapters. That is what this table is for.
 * - Whether a given endpoint, model or plan actually exposes the tool is **not** knowable
 *   locally — it is a property of the route the host chose, and the host is the only one
 *   who knows it.
 *
 * So the table lists only the families whose documented support is stable and whose
 * protocol this package can speak. Notable omissions, on purpose:
 *
 * - **Gemini and xAI** support server-side search but through APIs these adapters do not
 *   speak, so nothing here can declare it for them.
 * - **Gateway-proxied models** (DeepSeek, Z.ai/BigModel, and anything else behind an
 *   Anthropic- or OpenAI-compatible proxy) *may* pass the tool through, but that is a
 *   property of the gateway, not of the model name. Opt in explicitly with `families` or
 *   `capability`.
 *
 * The failure direction is chosen deliberately: an unknown model is treated as
 * **not** native-capable, which sends the call to the free or self-hosted tier. That is a
 * working answer. The opposite guess costs a round trip and can end in a silently
 * unsearched answer.
 */
export const NATIVE_SEARCH_FAMILIES: readonly NativeFamily[] = [
  { vendor: 'anthropic', pattern: /^claude/i, protocol: 'anthropic-messages' },
  { vendor: 'openai', pattern: /^(gpt-|chatgpt|o[1-9])/i, protocol: 'openai-responses' },
]

/** One entry of {@link NATIVE_SEARCH_FAMILIES}. */
export interface NativeFamily {
  /** Vendor name, used in diagnostics. */
  readonly vendor: string
  /** Matched against the model id, case-insensitively. */
  readonly pattern: RegExp
  /** The protocol that declares this vendor's server-side search tool. */
  readonly protocol: NativeProtocolName
}

/**
 * How to decide whether the active model can search natively.
 *
 * - `'auto'` (default) — the model matches a {@link NativeFamily}. Conservative: unknown
 *   models are treated as incapable.
 * - `'always'` — trust the route. Use it when the host knows the route serves the tool.
 * - `'never'` — never use the native tier, whatever the model.
 * - a predicate — the host decides; it is the only party that knows the route.
 */
export type NativeCapability = 'auto' | 'always' | 'never' | ((model: string | undefined) => boolean)

/**
 * Resolve the protocol that declares `model`'s server-side search tool.
 *
 * @param model - the active model id, if known.
 * @param families - the table to consult; defaults to {@link NATIVE_SEARCH_FAMILIES}.
 * @returns the protocol, or `undefined` when the family is unknown.
 */
export function nativeProtocolFor(
  model: string | undefined,
  families: readonly NativeFamily[] = NATIVE_SEARCH_FAMILIES,
): NativeProtocolName | undefined {
  if (model === undefined || model === '') return undefined
  for (const family of families) {
    // `pattern` is caller-supplied and may be global; `test` on a global regex is
    // stateful, so reset before each use.
    family.pattern.lastIndex = 0
    if (family.pattern.test(model)) return family.protocol
  }
  return undefined
}

/**
 * The vendor that owns `model`, for diagnostics.
 *
 * @param model - the active model id.
 * @param families - the table to consult.
 * @returns the vendor name, or `undefined` when unknown.
 */
export function nativeVendorFor(model: string | undefined, families: readonly NativeFamily[] = NATIVE_SEARCH_FAMILIES): string | undefined {
  if (model === undefined || model === '') return undefined
  for (const family of families) {
    family.pattern.lastIndex = 0
    if (family.pattern.test(model)) return family.vendor
  }
  return undefined
}

/* ── Tier configuration ────────────────────────────────────────────────────── */

/** The model vendor's own server-side search. */
export interface NativeTierConfig {
  /** Full URL of the messages/responses endpoint. The adapters never append a path. */
  readonly endpoint: string
  /**
   * The protocol that declares the tool. **Required**, and resolved when the deployment is
   * built rather than per call: the underlying provider derives both its identity and its
   * availability from this value, so it cannot be deferred to request time.
   *
   * Use {@link nativeProtocolFor} to pick it from a model id. A host that routes between
   * families needing different protocols needs more than one native tier — the two wire
   * formats are genuinely different, and guessing between them would produce a request the
   * vendor answers without searching.
   */
  readonly protocol: NativeProtocolName
  /** Override the model sent to the vendor. Omitted = the active model. */
  readonly model?: string | (() => string | undefined)
  readonly apiKey?: string
  readonly resolveApiKey?: () => Promise<string | undefined>
  readonly apiKeyRef?: string
  readonly maxUses?: number
  readonly maxTokens?: number
  readonly extraHeaders?: Record<string, string>
  readonly includeAnswer?: boolean
  /** Injectable HTTP client, for tests and for hosts with their own transport policy. */
  readonly fetch?: FetchLike
  /**
   * Whether the active model can search natively. Defaults to `'auto'`, which consults
   * {@link NATIVE_SEARCH_FAMILIES} and treats an unknown model as incapable.
   */
  readonly capability?: NativeCapability
  /**
   * Memoize the capability decision per model. Defaults to `true`.
   *
   * Safe for the built-in table and for any predicate that depends only on the model. Set it
   * to `false` when the predicate consults something that changes during a run — a live route
   * table, a feature flag — because a memoized decision would then be stale.
   */
  readonly capabilityCache?: boolean
  readonly families?: readonly NativeFamily[]
}

/** A free hosted search service, reached over MCP. */
export interface FreeTierConfig {
  /** A shipped profile id (`anysearch`, `exa-mcp`, `parallel-mcp`) or a custom profile. */
  readonly profile?: McpProfileRef
  readonly apiKey?: string
  readonly resolveApiKey?: () => Promise<string | undefined>
  readonly wireMaxResults?: number
  readonly includeRawText?: boolean
  readonly parseSearchText?: McpSearchProviderOptions['parseSearchText']
  /** Injectable HTTP client, for tests and for hosts with their own transport policy. */
  readonly fetch?: FetchLike
}

/** Your own deployment: the Web Content Service from `selfhosted/`. */
export interface SelfHostedTierConfig {
  /** Service base URL. */
  readonly baseURL: string
  /** Bearer token, when the service requires one. */
  readonly token?: string
  readonly searchPath?: string
  readonly extractPath?: string
  readonly extraHeaders?: Record<string, string>
  /** Default extraction mode. `auto` lets the service decide per page; see CONTRACT.md. */
  readonly mode?: WebContentMode
  readonly maxContentChars?: number
  /** Injectable HTTP client, for tests and for hosts with their own transport policy. */
  readonly fetch?: FetchLike
}

/** Everything a deployment needs to know. */
export interface DeploymentConfig {
  /** Namespace for the registered provider ids. Defaults to `deployment`. */
  readonly id?: string
  /** The host's current model. Read on every selection, so it can change as the agent routes. */
  readonly activeModel?: () => string | undefined
  /** The native tier, or `false` to leave it out entirely. */
  readonly native?: NativeTierConfig | false
  /** The free tier, or `false` to leave it out entirely. */
  readonly free?: FreeTierConfig | false
  /** The self-hosted tier, or `false` to leave it out entirely. */
  readonly selfHosted?: SelfHostedTierConfig | false
  /**
   * Preference order. Accepts a {@link TierPreset} name (`'privacy-first'`) or an explicit
   * tier list. Defaults to {@link DEFAULT_TIER_ORDER} (`native`, `free`, `self-hosted`).
   *
   * A preset states a preference, so tiers that are not configured are dropped from it. An
   * explicit array states a plan, so a tier named there but not configured is an error —
   * as is a configured tier missing from it.
   */
  readonly order?: readonly TierId[] | TierPreset
}

/**
 * A machine-readable account of what a deployment will do for one model.
 *
 * Exists because "which tier is it actually using, and why" is not answerable from the config
 * alone: the answer depends on the active model, on whether the route is native-capable, and
 * on each provider's own local readiness. Operators need that without reading this source.
 */
export interface DeploymentSnapshot {
  readonly id: string
  /** The model this snapshot describes, if one was known. */
  readonly model: string | undefined
  /** Every enabled tier, in preference order. */
  readonly tiers: readonly TierId[]
  /** The tiers actually reached for this model — `tiers` minus the native tier when skipped. */
  readonly activeTiers: readonly TierId[]
  /** The provider id to configure on the runtime. */
  readonly chain: string
  /** The chain that would be used if the native tier were skipped. */
  readonly fallbackChain: string
  readonly native: {
    readonly configured: boolean
    readonly capable: boolean
    /** Why the native tier is or is not usable, in one line. */
    readonly reason: string
    /** What produced that reason: a probe, a setting, a predicate, or the shipped table. */
    readonly source: CapabilitySource
    /** True when the decision came from a live probe rather than a local guess. */
    readonly probed: boolean
    readonly protocol?: NativeProtocolName
  }
  /** Each tier's provider id, its own local readiness, and whether the chain reaches it. */
  readonly providers: readonly {
    readonly tier: TierId
    readonly id: string
    /** The provider's own readiness: endpoint parses, credential present, path set. */
    readonly ready: boolean
    /** Whether this model's chain reaches the tier. False for the native tier when the route cannot use it. */
    readonly usable: boolean
  }[]
}

/** A built deployment. */
export interface Deployment {
  /** The namespace the provider ids are registered under. */
  readonly id: string
  /** The tiers that were actually built, in preference order. */
  readonly tiers: readonly TierId[]
  /**
   * The provider id to configure on the runtime for a given model.
   *
   * Returns the chain that starts at the native tier when the model is native-capable, and
   * the chain that skips it otherwise — so an incapable route never spends a request
   * failing through a tier it cannot use.
   *
   * @param activeModel - the model the host is routing to; defaults to the configured reader.
   */
  searchProviderFor(activeModel?: string): string
  /**
   * Why this deployment behaves the way it does, as data.
   * @param activeModel - the model to answer for; defaults to the configured reader.
   */
  inspect(activeModel?: string): DeploymentSnapshot
  /**
   * The same answer as {@link Deployment.inspect}, formatted for a log line or a `--dry-run`.
   * @param activeModel - the model to answer for; defaults to the configured reader.
   */
  describe(activeModel?: string): string
  /**
   * Ask the native route whether it can search, and cache the verdict. Opt-in: it costs one real
   * search per model. See the implementation notes on the method for when it is worth it.
   *
   * @param activeModel - the model to ask about; defaults to the configured reader.
   * @param options - the probe query and the trust windows.
   */
  probe(activeModel?: string, options?: CapabilityProbeOptions): Promise<CapabilityProbeResult>
  /** The tier providers, for a host that wants to register or pin one individually. */
  readonly providers: Readonly<Partial<Record<TierId, WebSearchProvider>>>
  /**
   * Register the composed chains on a runtime.
   * @param runtime - the runtime to register into.
   */
  register(runtime: WebSearchRuntime): void
}

/* ── Internals ─────────────────────────────────────────────────────────────── */

/**
 * Wrap a tier so the chain can skip it for a reason the inner provider cannot express.
 *
 * The native tier needs this: "this route has no server-side search tool" is not something
 * the vendor provider can answer, because it only knows its own configuration, not the
 * model the host routed to. Reporting unavailable here is what turns routing into a skipped
 * hop instead of a wasted request.
 *
 * The optional members are copied only when the inner provider has them, so "absent means
 * unsupported" survives the wrap.
 */
function gatedProvider(id: string, inner: WebSearchProvider, gate: () => boolean): WebSearchProvider {
  const wrapped: WebSearchProvider = {
    id,
    available: () => gate() && inner.available(),
    search: (request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> => inner.search(request, signal),
  }
  if (inner.batchSearch !== undefined) {
    const batch = inner.batchSearch.bind(inner)
    wrapped.batchSearch = (requests, signal) => batch(requests, signal)
  }
  if (inner.extract !== undefined) {
    const extract = inner.extract.bind(inner)
    wrapped.extract = (request: WebExtractRequest, signal?: AbortSignal): Promise<WebExtractResult> => extract(request, signal)
  }
  return wrapped
}

/** Resolve `model` whether it was given as a value or a reader. */
function readModel(value: string | (() => string | undefined) | undefined, fallback: () => string | undefined): string | undefined {
  if (typeof value === 'function') return value()
  return value ?? fallback()
}

/** Build the native tier, or `undefined` when it is not configured. */
/**
 * Where a capability decision came from.
 *
 * Recorded because "the table guessed" and "we asked the route and it answered" justify very
 * different amounts of confidence, and a diagnostic that hides the difference invites someone to
 * distrust the whole mechanism after one wrong guess.
 */
export type CapabilitySource =
  /** A live probe: the route was asked, and it answered. */
  | 'probe'
  /** `capability: 'always' | 'never'`. */
  | 'setting'
  /** The host's own predicate. */
  | 'predicate'
  /** The shipped family table. */
  | 'table'
  /** No native tier exists at all. */
  | 'config'

/** Whether the native tier can be used for a model, and why — a bare boolean cannot be audited. */
export interface CapabilityDecision {
  /** True when the native tier should be tried for this model. */
  readonly capable: boolean
  /** A one-line justification, surfaced by {@link Deployment.describe}. */
  readonly reason: string
  /** Which mechanism produced this decision. */
  readonly source: CapabilitySource
}

/** The outcome of asking a route whether it can search. */
export interface CapabilityProbeResult {
  /** The model that was probed. */
  readonly model: string | undefined
  /** True when the route returned a search result. */
  readonly capable: boolean
  /** Why, in one line. */
  readonly reason: string
  /**
   * When this verdict stops being trusted, as a Unix timestamp. Absent means it does not expire
   * within this process.
   */
  readonly expiresAt?: number
  /** True when a previous probe, or one already in flight, answered instead of a new request. */
  readonly reused: boolean
}

/** How to run a capability probe. */
export interface CapabilityProbeOptions {
  /**
   * The query sent to the vendor. Deliberately trivial: a probe **is** a real search and costs a
   * real search, so it should ask for as little as possible.
   */
  readonly query?: string
  /**
   * How long a **negative** verdict is trusted, in milliseconds. Defaults to 5 minutes.
   *
   * The negative is the uncertain one: from here, "the tool was ignored" and "the network
   * hiccuped" look alike, and only one of them is permanent. A short trust window makes a wrong
   * negative self-correcting. `0` trusts it forever, which is only right for a route that is
   * known not to change.
   */
  readonly negativeTtlMs?: number
  /**
   * How long a **positive** verdict is trusted. Defaults to `0`, meaning the process lifetime: a
   * route that answered with results can search, and that does not change because time passed.
   */
  readonly positiveTtlMs?: number
}

/** The default probe query. It names itself, in case it shows up in a vendor's logs. */
const DEFAULT_PROBE_QUERY = 'search capability self-check'

/** How long a negative probe verdict is trusted by default. */
const DEFAULT_NEGATIVE_TTL_MS = 5 * 60 * 1000

/**
 * Verdicts from live probes, with their trust windows and their in-flight requests.
 *
 * Kept apart from the computed-decision memo because they answer different questions: the memo
 * caches "what does the table say", this caches "what did the route actually do". An observation
 * does not go stale because a host turned off memoization of a computation.
 */
class ProbeCache {
  private readonly verdicts = new Map<string, { decision: CapabilityDecision; expiresAt: number | undefined }>()
  private readonly inFlight = new Map<string, Promise<CapabilityProbeResult>>()

  /** A verdict that has not expired, if there is one. */
  get(model: string | undefined): CapabilityDecision | undefined {
    const key = model ?? ''
    const entry = this.verdicts.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      // An expired verdict must go, or one transient failure becomes a permanent verdict.
      this.verdicts.delete(key)
      return undefined
    }
    return entry.decision
  }

  /** Record a verdict. */
  set(model: string | undefined, decision: CapabilityDecision, ttlMs: number): void {
    this.verdicts.set(model ?? '', {
      decision,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : undefined,
    })
  }

  /** The expiry of a stored verdict, for reporting. */
  expiresAt(model: string | undefined): number | undefined {
    return this.verdicts.get(model ?? '')?.expiresAt
  }

  /** Run `probe`, sharing one in-flight request per model. */
  async once(model: string | undefined, probe: () => Promise<CapabilityProbeResult>): Promise<CapabilityProbeResult> {
    const key = model ?? ''
    const existing = this.inFlight.get(key)
    // A host that probes in a loop must not turn one model into N vendor requests.
    if (existing !== undefined) return { ...await existing, reused: true }
    const started = probe()
    this.inFlight.set(key, started)
    try {
      return await started
    } finally {
      this.inFlight.delete(key)
    }
  }
}

/**
 * Bounded cache of capability decisions, keyed by model id.
 *
 * Worth having because the predicate belongs to the host: it may do real work (consult a route
 * table, probe a gateway). For the built-in table the decision is a pure function of the model,
 * so caching cannot change behaviour; a host whose predicate is *dynamic* must opt out with
 * `capabilityCache: false`, and the option's documentation says so.
 *
 * On overflow the whole cache is dropped rather than tracking recency. The key space is model
 * ids, which are few, so a crude bound is enough and the bookkeeping would cost more than it
 * saves.
 */
class CapabilityCache {
  private readonly entries = new Map<string, CapabilityDecision>()

  /** @param limit - entries to keep before dropping the cache wholesale. */
  constructor(private readonly limit: number) {}

  /** Read a cached decision for `model`, if there is one. */
  get(model: string | undefined): CapabilityDecision | undefined {
    return this.entries.get(model ?? '')
  }

  /** Store a decision for `model`. */
  set(model: string | undefined, decision: CapabilityDecision): void {
    if (this.entries.size >= this.limit) this.entries.clear()
    this.entries.set(model ?? '', decision)
  }
}

/** Entries kept before the capability cache is dropped. Models are few; this is generous. */
const CAPABILITY_CACHE_LIMIT = 64

/** Resolves which model a decision is about, and what the decision is. */
interface CapabilityResolver {
  /** The model a decision would be about. Exposed so diagnostics cannot use a different one. */
  modelFor(override?: string): string | undefined
  /** Whether the native tier can be used, and why. */
  decide(override?: string): CapabilityDecision
}

/**
 * Build the single capability resolver, used by **both** the tier's availability gate and the
 * router.
 *
 * One resolver rather than two, because two implementations of the same question drift — and
 * they had. The gate read the configured model while the router read the active model, so with
 * a static `model` in the config and a different active model, `available()` reported `true`
 * while the router refused to select that tier. The diagnostic lied about the behaviour.
 *
 * @param config - the native tier configuration.
 * @param activeModel - the host's current model reader.
 * @param cacheEnabled - whether to memoize decisions per model.
 * @param probes - verdicts from live probes, which take precedence as the most direct evidence.
 * @returns the resolver.
 */
function capabilityResolver(
  config: NativeTierConfig,
  activeModel: () => string | undefined,
  cacheEnabled: boolean,
  probes: ProbeCache,
): CapabilityResolver {
  const families = config.families ?? NATIVE_SEARCH_FAMILIES
  const capability = config.capability ?? 'auto'
  const cache = cacheEnabled ? new CapabilityCache(CAPABILITY_CACHE_LIMIT) : undefined

  /**
   * Which model a routing decision is about.
   *
   * Order: the per-call argument, then the host's active model, then a pinned `model` as a last
   * resort. The argument comes first because `searchProviderFor(model)` would otherwise be
   * misleading — you hand it a model and it silently answers for a different one.
   *
   * The pinned `model` is deliberately **not** authoritative here even though it is what the
   * vendor request names: pinning says "send this model to the vendor", not "the agent is using
   * this model". Routing follows the agent. The pin only decides the answer when the host knows
   * of no model at all, which is the case where a pinned-only deployment would otherwise report
   * itself permanently incapable.
   */
  const modelFor = (override?: string): string | undefined => {
    if (override !== undefined) return override
    return activeModel() ?? readModel(config.model, () => undefined)
  }

  /**
   * The local guess, with no probe lookup. Probes are consulted by the caller, **before** the
   * memo — see `decide`.
   */
  const decideLocally = (model: string | undefined): CapabilityDecision => {
    // Order, and why:
    //   `never` first — it is an instruction not to use this tier, and no evidence makes a
    //   disabled tier desirable.
    //   then `always` — an assertion about the route, which evidence is allowed to overrule.
    //   then the host predicate, then the shipped table — increasingly indirect guesses.
    if (capability === 'never') return { capable: false, reason: 'capability is set to "never"', source: 'setting' }
    if (capability === 'always') {
      return { capable: true, reason: 'capability is set to "always" (the route is trusted)', source: 'setting' }
    }
    if (typeof capability === 'function') {
      return capability(model)
        ? { capable: true, reason: 'the host predicate reported this model capable', source: 'predicate' }
        : { capable: false, reason: 'the host predicate reported this model incapable', source: 'predicate' }
    }
    if (model === undefined || model === '') {
      // Nothing to match against, so nothing to claim — and the vendor request would have no
      // model to name either, which is why this is a refusal rather than a default.
      return { capable: false, reason: 'no active model is known, so the families cannot be consulted', source: 'table' }
    }
    const protocol = nativeProtocolFor(model, families)
    if (protocol === undefined) {
      return {
        capable: false,
        reason: `${JSON.stringify(model)} matches no family in the capability table`,
        source: 'table',
      }
    }
    return {
      capable: true,
      reason: `${JSON.stringify(model)} matches the ${nativeVendorFor(model, families)} family (${protocol})`,
      source: 'table',
    }
  }

  return {
    modelFor,
    decide(override?: string): CapabilityDecision {
      const model = modelFor(override)
      // Evidence before computation, and before the memo of that computation. Ordering this the
      // other way round lets a memoized guess mask the probe result — the probe then succeeds and
      // changes nothing, which looks exactly like a probe that does not work.
      const observed = probes.get(model)
      if (observed !== undefined) return observed
      const cached = cache?.get(model)
      if (cached !== undefined) return cached
      const decision = decideLocally(model)
      cache?.set(model, decision)
      return decision
    },
  }
}

/**
 * Ask a route whether it can search, by making one minimal search through it.
 *
 * The signal is **"did the adapter raise?"**, not "did it return sources". The protocol adapters
 * raise specifically when the response carries no `web_search_tool_result` block — which is
 * exactly the "the route silently ignored the tool" case — so a call that returns at all is proof
 * that the tool ran, even if the query found nothing.
 *
 * @param inner - the ungated vendor provider. The gate must be bypassed: its whole purpose is to
 *   refuse the routes this function exists to ask about.
 * @param probes - the verdict cache to write into.
 * @param model - the model being probed.
 * @param options - query and trust windows.
 * @returns the verdict.
 */
async function runProbe(
  inner: WebSearchProvider,
  probes: ProbeCache,
  model: string | undefined,
  options: CapabilityProbeOptions,
): Promise<CapabilityProbeResult> {
  const query = options.query ?? DEFAULT_PROBE_QUERY
  const negativeTtl = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS
  const positiveTtl = options.positiveTtlMs ?? 0

  try {
    await inner.search({ query, maxResults: 1 })
    const decision: CapabilityDecision = {
      capable: true,
      reason: 'the route returned a response that honoured the server-side search tool',
      source: 'probe',
    }
    probes.set(model, decision, positiveTtl)
    const expiresAt = probes.expiresAt(model)
    return {
      model,
      capable: true,
      reason: decision.reason,
      ...expiresAt !== undefined ? { expiresAt } : {},
      reused: false,
    }
  } catch (error: unknown) {
    const code = error instanceof WebError ? error.code : undefined
    if (code === WEB_ABORTED || code === INVALID_ARGS || code === WEB_PROVIDER_CREDENTIAL_MISSING) {
      // Not a verdict about the route: the caller cancelled, the arguments were wrong, or the
      // credential is missing. Recording any of these as "this route cannot search" would
      // disable a perfectly good tier for a reason that has a different fix.
      return {
        model,
        capable: false,
        reason: `inconclusive — ${code}: ${error instanceof Error ? error.message : String(error)}`,
        reused: false,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    const decision: CapabilityDecision = {
      capable: false,
      reason: `the probe failed, so the route is treated as unable to search: ${message.slice(0, 300)}`,
      source: 'probe',
    }
    // A TTL, because "no tool" and "transient failure" are indistinguishable from here and only
    // one of them is permanent. `negativeTtlMs: 0` is available for a route known not to change.
    probes.set(model, decision, negativeTtl)
    const expiresAt = probes.expiresAt(model)
    return {
      model,
      capable: false,
      reason: decision.reason,
      ...expiresAt !== undefined ? { expiresAt } : {},
      reused: false,
    }
  }
}

/** The native tier, the resolver that explains it, and the ungated provider underneath. */
interface NativeTier {
  /** The gated provider the chain holds: `available()` answers "can this route use it". */
  readonly provider: WebSearchProvider
  /**
   * The vendor provider itself, whose `available()` answers "is this tier configured
   * correctly" without consulting the route. Reported separately so a diagnostic cannot
   * contradict itself.
   */
  readonly inner: WebSearchProvider
  readonly capable: CapabilityResolver
}

/**
 * Build the native tier, or `undefined` when it is not configured.
 *
 * @param config - the tier configuration.
 * @param activeModel - the host's current model reader.
 * @returns the gated provider and its capability resolver.
 */
function buildNative(
  config: NativeTierConfig | false | undefined,
  activeModel: () => string | undefined,
  probes: ProbeCache,
): NativeTier | undefined {
  if (config === false || config === undefined) return undefined
  const capable = capabilityResolver(config, activeModel, config.capabilityCache ?? true, probes)
  const model = (): string | undefined => readModel(config.model, activeModel)

  const inner = nativeSearchProvider({
    // Read per call, so a model change is picked up without rebuilding the deployment.
    protocol: config.protocol,
    endpoint: config.endpoint,
    model: model() ?? '',
    ...config.apiKey !== undefined ? { apiKey: config.apiKey } : {},
    ...config.resolveApiKey !== undefined ? { resolveApiKey: config.resolveApiKey } : {},
    ...config.apiKeyRef !== undefined ? { apiKeyRef: config.apiKeyRef } : {},
    ...config.maxUses !== undefined ? { maxUses: config.maxUses } : {},
    ...config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {},
    ...config.extraHeaders !== undefined ? { extraHeaders: config.extraHeaders } : {},
    ...config.includeAnswer !== undefined ? { includeAnswer: config.includeAnswer } : {},
    ...config.fetch !== undefined ? { fetch: config.fetch } : {},
  })

  // The gate is the whole point: the vendor provider cannot know that the *route the host
  // chose* has no server-side tool, so reporting unavailable here is what turns routing
  // into a skipped hop instead of a request that costs a round trip and may come back with
  // an answer that was never searched for.
  return { provider: gatedProvider('native', inner, () => capable.decide().capable), inner, capable }
}

/** Build the free tier, or `undefined` when it is not configured. */
function buildFree(config: FreeTierConfig | false | undefined): WebSearchProvider | undefined {
  if (config === false || config === undefined) return undefined
  return mcpSearchProvider({
    profile: config.profile ?? 'anysearch',
    ...config.apiKey !== undefined ? { apiKey: config.apiKey } : {},
    ...config.resolveApiKey !== undefined ? { resolveApiKey: config.resolveApiKey } : {},
    ...config.wireMaxResults !== undefined ? { wireMaxResults: config.wireMaxResults } : {},
    ...config.includeRawText !== undefined ? { includeRawText: config.includeRawText } : {},
    ...config.parseSearchText !== undefined ? { parseSearchText: config.parseSearchText } : {},
    ...config.fetch !== undefined ? { fetch: config.fetch } : {},
  })
}

/** Build the self-hosted tier, or `undefined` when it is not configured. */
function buildSelfHosted(config: SelfHostedTierConfig | false | undefined): WebSearchProvider | undefined {
  if (config === false || config === undefined) return undefined
  return webContentProvider({
    baseURL: config.baseURL,
    ...config.token !== undefined ? { token: config.token } : {},
    ...config.searchPath !== undefined ? { searchPath: config.searchPath } : {},
    ...config.extractPath !== undefined ? { extractPath: config.extractPath } : {},
    ...config.extraHeaders !== undefined ? { extraHeaders: config.extraHeaders } : {},
    ...config.mode !== undefined ? { mode: config.mode } : {},
    ...config.maxContentChars !== undefined ? { maxContentChars: config.maxContentChars } : {},
    ...config.fetch !== undefined ? { fetch: config.fetch } : {},
  })
}

/* ── The entry point ───────────────────────────────────────────────────────── */

/**
 * Build a deployment from configuration.
 *
 * @param config - the tiers to enable and the order to try them in.
 * @returns the deployment, ready to register.
 * @throws Error when no tier is enabled, or when `order` names a tier that is not
 *   configured — both are configuration mistakes that would otherwise surface as a
 *   confusing "no usable provider" at request time.
 */
export function createDeployment(config: DeploymentConfig): Deployment {
  const id = config.id ?? 'deployment'
  const activeModel = config.activeModel ?? ((): string | undefined => undefined)

  const built: Partial<Record<TierId, WebSearchProvider>> = {}
  const probes = new ProbeCache()
  const native = buildNative(config.native, activeModel, probes)
  const free = buildFree(config.free)
  const selfHosted = buildSelfHosted(config.selfHosted)
  if (native !== undefined) built.native = native.provider
  if (free !== undefined) built.free = free
  if (selfHosted !== undefined) built['self-hosted'] = selfHosted

  const { tiers: order, explicit: orderIsExplicit } = resolveTierOrder(config.order)
  const duplicated = order.filter((tier, index) => order.indexOf(tier) !== index)
  if (duplicated.length > 0) {
    throw new Error(`createDeployment: \`order\` repeats ${[...new Set(duplicated)].join(', ')}`)
  }
  // An explicit array is a statement of intent, so both directions of a mismatch are
  // mistakes worth failing on. A preset or the default is a statement of *preference*:
  // it names all three tiers, so one that was simply left out of the config is filtered
  // away rather than reported. Without that distinction, "I only deployed my own server"
  // would be an error, and so would `order: 'privacy-first'` without a native tier.
  if (orderIsExplicit) {
    for (const tier of order) {
      if (built[tier] === undefined) {
        throw new Error(
          `createDeployment: \`order\` names the "${tier}" tier, which is not configured; `
          + `configured tiers: ${Object.keys(built).join(', ') || '(none)'}`,
        )
      }
    }
    const unlisted = (Object.keys(built) as TierId[]).filter(tier => !order.includes(tier))
    if (unlisted.length > 0) {
      throw new Error(
        `createDeployment: ${unlisted.join(', ')} configured but missing from \`order\` (${order.join(', ')}); `
        + 'add it to `order` so it is actually used',
      )
    }
  }
  const enabledInOrder = order.filter(tier => built[tier] !== undefined)
  if (enabledInOrder.length === 0) {
    throw new Error('createDeployment: enable at least one of native, free, or self-hosted')
  }

  const chainFor = (chainId: string, tiers: readonly TierId[]): WebSearchProvider => fallbackSearchProvider({
    id: chainId,
    providers: tiers.map(tier => built[tier] as WebSearchProvider),
  })

  // Two chains, with ids that cannot collide: the full preference order, and the same order
  // with the native tier removed. The second only exists when it differs from the first —
  // with no native tier, or with nothing else to fall through to, one chain answers both.
  const fullChain = chainFor(id, enabledInOrder)
  const withoutNative = enabledInOrder.filter(tier => tier !== 'native')
  const reducedChain = native !== undefined && withoutNative.length > 0
    ? chainFor(`${id}-no-native`, withoutNative)
    : undefined
  /** The id used when the route cannot use the native tier. */
  const reducedId = reducedChain?.id ?? fullChain.id

  /**
   * Decide which chain to use, and why.
   *
   * Delegates to the tier's own resolver, so the router and the availability gate can never
   * disagree about the same model.
   *
   * @param model - the model to decide for; defaults to the configured reader.
   * @returns the provider id to configure on the runtime.
   */
  const searchProviderFor = (model?: string): string => {
    if (native === undefined || reducedChain === undefined) return fullChain.id
    return native.capable.decide(model).capable ? fullChain.id : reducedId
  }

  /**
   * The model a snapshot describes — the resolver's answer when there is a native tier, so a
   * diagnostic cannot name a different model than the one the decision was made about.
   */
  const modelFor = (override?: string): string | undefined => native !== undefined
    ? native.capable.modelFor(override)
    : override ?? activeModel()

  const inspect = (model?: string): DeploymentSnapshot => {
    const resolved = modelFor(model)
    const decision = native === undefined
      ? { capable: false, reason: 'no native tier is configured', source: 'config' as const }
      : native.capable.decide(model)
    const chain = searchProviderFor(model)
    const activeTiers = enabledInOrder.filter(tier => tier !== 'native' || decision.capable)
    const nativeProtocol = (config.native as NativeTierConfig | undefined)?.protocol
    return {
      id,
      model: resolved,
      tiers: enabledInOrder,
      activeTiers,
      chain,
      fallbackChain: reducedId,
      native: {
        configured: native !== undefined,
        capable: decision.capable,
        reason: decision.reason,
        source: decision.source,
        probed: decision.source === 'probe',
        ...nativeProtocol !== undefined ? { protocol: nativeProtocol } : {},
      },
      providers: enabledInOrder.map(tier => {
        const provider = built[tier]
        // For the native tier, "is it configured correctly" and "can this route use it" are
        // different questions. Asking the gated provider only answers the second, so the inner
        // provider answers the first — otherwise a snapshot would show `capable: false` next to
        // `available: true`, which is the kind of contradiction this module exists to remove.
        const ready = tier === 'native' && native !== undefined ? native.inner.available() : provider?.available() === true
        return {
          tier,
          id: provider?.id ?? '',
          ready,
          usable: activeTiers.includes(tier),
        }
      }),
    }
  }

  const describe = (model?: string): string => {
    const snapshot = inspect(model)
    const fallbackNote = snapshot.chain === snapshot.fallbackChain
      ? ''
      : `  (if the native route cannot be used: ${snapshot.fallbackChain})`
    const lines = [
      `deployment ${JSON.stringify(snapshot.id)} — model ${snapshot.model ?? '(none known)'}`,
      `  chain:    ${snapshot.chain}${fallbackNote}`,
      `  tiers:    ${snapshot.activeTiers.join(' -> ') || '(none)'}`,
      // The source is on the line because "the table guessed" and "we asked the route" justify
      // different levels of confidence.
      `  native:   ${snapshot.native.capable ? 'usable' : 'skipped'}`
        + `${snapshot.native.probed ? ' (probed)' : ' (from config)'} — ${snapshot.native.reason}`,
      '  providers:',
    ]
    for (const entry of snapshot.providers) {
      // Readiness and reachability are reported separately because they need different fixes:
      // a missing credential is not a routing problem.
      const state = entry.ready
        ? entry.usable ? 'ready' : 'ready, but not reached for this model'
        : 'NOT ready'
      lines.push(`    ${entry.tier.padEnd(12)} ${entry.id.padEnd(12)} ${state}`)
    }
    return lines.join('\n')
  }

  /**
   * Ask the native route whether it can actually search, and remember the answer.
   *
   * Worth doing when the route is **not** one the shipped table knows about — a gateway, a
   * proxied model, a plan whose features are not documented — because the table's honest answer
   * there is "unknown", and unknown means the tier never runs. A probe converts that guess into
   * evidence.
   *
   * It **is** a real search: one query, one `maxResults`, on your account. Call it once per model
   * at startup rather than per request; results are cached, and concurrent calls for the same
   * model share one request. Nothing is probed unless this is called, so an untouched deployment
   * makes no extra requests.
   *
   * @param model - the model to ask about; defaults to the configured reader.
   * @param options - the probe query and how long each verdict is trusted.
   * @returns the verdict, whether it was reused from cache, and when it expires.
   */
  const probe = async (model?: string, options: CapabilityProbeOptions = {}): Promise<CapabilityProbeResult> => {
    const resolved = modelFor(model)
    if (native === undefined) {
      return { model: resolved, capable: false, reason: 'no native tier is configured', reused: false }
    }
    if ((config.native as NativeTierConfig | undefined)?.capability === 'never') {
      // Refuse before the request, not after: spending a real search to learn about a tier the
      // host has switched off helps nobody.
      return {
        model: resolved,
        capable: false,
        reason: 'capability is set to "never", so there is nothing to probe',
        reused: false,
      }
    }
    const known = probes.get(resolved)
    if (known !== undefined) {
      const expiresAt = probes.expiresAt(resolved)
      return {
        model: resolved,
        capable: known.capable,
        reason: known.reason,
        ...expiresAt !== undefined ? { expiresAt } : {},
        reused: true,
      }
    }
    // The inner provider, not the gated one: the gate exists to refuse exactly the routes this
    // method is asking about.
    return probes.once(resolved, () => runProbe(native.inner, probes, resolved, options))
  }

  return {
    id,
    tiers: enabledInOrder,
    providers: built,
    searchProviderFor,
    inspect,
    describe,
    probe,
    register(runtime: WebSearchRuntime): void {
      // Registering both chains means the runtime's selector can name either one, and the
      // chains hold their tier providers directly, so no per-tier registration is needed.
      runtime.registerSearchProvider(fullChain)
      if (reducedChain !== undefined) runtime.registerSearchProvider(reducedChain)
    },
  }
}
