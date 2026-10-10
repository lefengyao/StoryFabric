/**
 * A deployment described by data, so changing a model or an endpoint does not mean editing
 * code and redeploying.
 *
 * The shape mirrors `DeploymentConfig`, with two deliberate differences that come from the
 * fact that this arrives as JSON:
 *
 * 1. **Secrets are named, not embedded.** `apiKeyRef` / `tokenRef` name an environment
 *    variable, which is resolved when the deployment is built. A config file gets committed,
 *    shared and pasted into tickets; a token should never be in one. A named variable that
 *    is missing is an error **at load time**, not at the first search — a deployment that
 *    cannot authenticate should not start.
 * 2. **A predicate cannot be expressed.** `capability` takes `'auto' | 'always' | 'never'`,
 *    and `capableModels` accepts glob patterns for the case a function would have covered —
 *    which is also more useful here, because it records the routes *this* deployment knows
 *    about rather than the ones a shipped table guesses at.
 *
 * Every rejection names the JSON path it came from, because the person reading the error is
 * looking at a config file, not at this code.
 *
 * ```jsonc
 * {
 *   "order": "privacy-first",
 *   "native": { "endpoint": "https://api.anthropic.com/v1/messages", "protocol": "anthropic-messages", "apiKeyRef": "ANTHROPIC_API_KEY" },
 *   "free": { "profile": "anysearch" },
 *   "selfHosted": { "baseURL": "https://search.example.com", "tokenRef": "SEARCH_TOKEN", "mode": "auto" }
 * }
 * ```
 * @module web-search-standalone/deployment-config
 */

import type {
  Deployment,
  FreeTierConfig,
  NativeCapability,
  NativeProtocolName,
  NativeTierConfig,
  SelfHostedTierConfig,
  TierId,
  TierPreset,
} from './deployment'
import { createDeployment } from './deployment'
import type { WebContentMode } from './providers/webcontent'

/** The environment a `*Ref` is resolved against. */
export type Environment = Readonly<Record<string, string | undefined>>

/** How to build from a parsed config. */
export interface BuildFromConfigOptions {
  /**
   * The host's current model. Not part of the file: it changes as the agent routes, and file
   * content is meant to be stable across a run.
   */
  readonly activeModel?: () => string | undefined
  /** Where `*Ref` names are looked up. Defaults to `process.env`. */
  readonly env?: Environment
}

/* ── Validation helpers ────────────────────────────────────────────────────── */

/** Reject anything that is not a plain object, naming the path. */
function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

/**
 * Reject keys the schema does not define — a typo must not be silently ignored.
 *
 * Keys prefixed with `_` or `$` are documentation and are ignored: JSON has no comments, so
 * that is the conventional escape hatch, and without it an annotated example config could not
 * be copied into place without failing validation.
 */
function onlyKeys(source: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(source).filter(key => !allowed.includes(key) && !key.startsWith('_') && !key.startsWith('$'))
  if (unknown.length > 0) {
    throw new Error(`${path} has unknown keys: ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`)
  }
}

/** Read an optional string. */
function string(source: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = source[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string`)
  return value
}

/** Read an optional positive integer. */
function positiveInt(source: Record<string, unknown>, key: string, path: string): number | undefined {
  const value = source[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path}.${key} must be a positive integer`)
  }
  return value
}

/** Read an optional value from a fixed set. */
function oneOf<T extends string>(source: Record<string, unknown>, key: string, path: string, allowed: readonly T[]): T | undefined {
  const value = string(source, key, path)
  if (value === undefined) return undefined
  if (!allowed.includes(value as T)) {
    throw new Error(`${path}.${key} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`)
  }
  return value as T
}

/** Read an optional array of non-empty strings. */
function stringArray(source: Record<string, unknown>, key: string, path: string): readonly string[] | undefined {
  const value = source[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry === '')) {
    throw new Error(`${path}.${key} must be an array of non-empty strings`)
  }
  return value as readonly string[]
}

/**
 * Resolve a direct value or its `*Ref` sibling, which names an environment variable.
 *
 * @returns the value, or undefined when neither was given.
 * @throws Error when both are given at once, or when the named variable is unset.
 */
function valueOrRef(
  source: Record<string, unknown>,
  directKey: string,
  refKey: string,
  path: string,
  env: Environment,
): string | undefined {
  const direct = string(source, directKey, path)
  const ref = string(source, refKey, path)
  if (direct !== undefined && ref !== undefined) {
    throw new Error(`${path}: set either ${directKey} or ${refKey}, not both`)
  }
  if (ref === undefined) return direct
  const value = env[ref]
  if (value === undefined || value === '') {
    // Failing here rather than at the first request is the point: the deployment cannot
    // authenticate, and finding that out at startup is cheaper than finding it out in
    // production.
    throw new Error(`${path}.${refKey} names the environment variable ${JSON.stringify(ref)}, which is not set`)
  }
  return value
}

/**
 * Compile glob patterns into a predicate. `*` matches any run of characters; the match is
 * anchored and case-insensitive, so `"claude-*"` covers `claude-sonnet-5`.
 *
 * @param patterns - the model patterns from the config.
 * @returns a predicate suitable for `capability`.
 */
export function globPredicate(patterns: readonly string[]): (model: string | undefined) => boolean {
  const compiled = patterns.map(pattern => new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    'i',
  ))
  return model => model !== undefined && compiled.some(expression => expression.test(model))
}

/* ── The tier builders ─────────────────────────────────────────────────────── */

const NATIVE_KEYS = ['endpoint', 'endpointRef', 'protocol', 'model', 'apiKey', 'apiKeyRef', 'capability', 'capableModels', 'maxUses', 'maxTokens'] as const
const FREE_KEYS = ['profile', 'apiKey', 'apiKeyRef', 'wireMaxResults'] as const
const SELF_HOSTED_KEYS = ['baseURL', 'token', 'tokenRef', 'searchPath', 'extractPath', 'mode', 'maxContentChars'] as const
const ROOT_KEYS = ['id', 'order', 'native', 'free', 'selfHosted'] as const

const PROTOCOLS: readonly NativeProtocolName[] = ['anthropic-messages', 'openai-responses']
/** The capability values a config file can express; a predicate is not expressible in JSON. */
type CapabilityName = 'auto' | 'always' | 'never'
const CAPABILITIES: readonly CapabilityName[] = ['auto', 'always', 'never']
const MODES: readonly WebContentMode[] = ['static', 'render', 'auto']
const TIER_IDS: readonly string[] = ['native', 'free', 'self-hosted']
const PRESETS: readonly TierPreset[] = ['native-first', 'privacy-first', 'cost-first']

/**
 * The schema this module enforces, as data.
 *
 * Exported so the JSON Schema is **generated from the same source the validator uses**. A
 * hand-written schema is a second implementation of the same rules, and the two drift the
 * moment either changes — the failure being a schema that promises a setting the validator
 * rejects, or (worse) accepts a typo the schema would have caught.
 */
export const DEPLOYMENT_CONFIG_SCHEMA_SOURCE = {
  root: ROOT_KEYS,
  native: NATIVE_KEYS,
  free: FREE_KEYS,
  selfHosted: SELF_HOSTED_KEYS,
  protocols: PROTOCOLS,
  capabilities: CAPABILITIES,
  modes: MODES,
  tiers: TIER_IDS,
  presets: PRESETS,
  /** Keys with this prefix are documentation and are ignored, in both the schema and the validator. */
  commentPattern: '^[_$]',
} as const

/** Build the native tier, resolving refs and compiling `capableModels`. */
function nativeTier(source: Record<string, unknown>, env: Environment): NativeTierConfig {
  const path = 'deployment.native'
  onlyKeys(source, NATIVE_KEYS, path)

  const endpoint = valueOrRef(source, 'endpoint', 'endpointRef', path, env)
  if (endpoint === undefined || endpoint === '') throw new Error(`${path}.endpoint is required (or set endpointRef)`)
  const protocol = oneOf(source, 'protocol', path, PROTOCOLS)
  if (protocol === undefined) throw new Error(`${path}.protocol is required and must be one of ${PROTOCOLS.join(', ')}`)

  const named = oneOf(source, 'capability', path, CAPABILITIES)
  const capableModels = stringArray(source, 'capableModels', path)
  // `capableModels` wins when present: it is the deployment's own knowledge of its routes,
  // which beats a shipped table.
  const capability: NativeCapability = capableModels !== undefined ? globPredicate(capableModels) : (named ?? 'auto')

  const apiKey = valueOrRef(source, 'apiKey', 'apiKeyRef', path, env)
  const model = string(source, 'model', path)
  const maxUses = positiveInt(source, 'maxUses', path)
  const maxTokens = positiveInt(source, 'maxTokens', path)
  return {
    endpoint,
    protocol,
    capability,
    ...model !== undefined ? { model } : {},
    ...apiKey !== undefined ? { apiKey } : {},
    ...maxUses !== undefined ? { maxUses } : {},
    ...maxTokens !== undefined ? { maxTokens } : {},
  }
}

/** Build the free tier. */
function freeTier(source: Record<string, unknown>, env: Environment): FreeTierConfig {
  const path = 'deployment.free'
  onlyKeys(source, FREE_KEYS, path)
  const apiKey = valueOrRef(source, 'apiKey', 'apiKeyRef', path, env)
  const profile = string(source, 'profile', path)
  const wireMaxResults = positiveInt(source, 'wireMaxResults', path)
  return {
    ...profile !== undefined ? { profile } : {},
    ...apiKey !== undefined ? { apiKey } : {},
    ...wireMaxResults !== undefined ? { wireMaxResults } : {},
  }
}

/** Build the self-hosted tier. */
function selfHostedTier(source: Record<string, unknown>, env: Environment): SelfHostedTierConfig {
  const path = 'deployment.selfHosted'
  onlyKeys(source, SELF_HOSTED_KEYS, path)

  const baseURL = string(source, 'baseURL', path)
  if (baseURL === undefined || baseURL === '') throw new Error(`${path}.baseURL is required and must be a non-empty string`)
  const mode = oneOf(source, 'mode', path, MODES)
  const token = valueOrRef(source, 'token', 'tokenRef', path, env)
  const searchPath = string(source, 'searchPath', path)
  const extractPath = string(source, 'extractPath', path)
  const maxContentChars = positiveInt(source, 'maxContentChars', path)
  return {
    baseURL,
    ...token !== undefined ? { token } : {},
    ...searchPath !== undefined ? { searchPath } : {},
    ...extractPath !== undefined ? { extractPath } : {},
    ...mode !== undefined ? { mode } : {},
    ...maxContentChars !== undefined ? { maxContentChars } : {},
  }
}

/** Read `order`, which is a preset name or an explicit tier list. */
function readOrder(root: Record<string, unknown>): readonly TierId[] | TierPreset | undefined {
  const raw = root.order
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string') return raw as TierPreset
  if (Array.isArray(raw)) {
    if (raw.some(entry => typeof entry !== 'string' || !TIER_IDS.includes(entry))) {
      throw new Error(`deployment.order must list tier ids from ${TIER_IDS.join(', ')}, got ${JSON.stringify(raw)}`)
    }
    return raw as readonly TierId[]
  }
  throw new Error('deployment.order must be a preset name or an array of tier ids')
}

/* ── The entry points ──────────────────────────────────────────────────────── */

/**
 * Build a deployment from a parsed config object.
 *
 * @param source - the parsed config, typically `JSON.parse` output.
 * @param options - the active-model reader and the environment `*Ref` names resolve against.
 * @returns the deployment, ready to register.
 * @throws Error naming the offending JSON path, for every kind of misconfiguration.
 */
export function deploymentFromConfig(source: unknown, options: BuildFromConfigOptions = {}): Deployment {
  const env = options.env ?? (typeof process === 'undefined' ? {} : process.env)
  const root = asObject(source, 'deployment')
  onlyKeys(root, ROOT_KEYS, 'deployment')

  const order = readOrder(root)
  const id = string(root, 'id', 'deployment')
  // Each tier is built exactly once, so a validation error fires once and the resolved
  // secrets are not re-derived.
  const native = root.native === undefined || root.native === null
    ? undefined
    : root.native === false ? false : nativeTier(asObject(root.native, 'deployment.native'), env)
  const free = root.free === undefined || root.free === null
    ? undefined
    : root.free === false ? false : freeTier(asObject(root.free, 'deployment.free'), env)
  const selfHosted = root.selfHosted === undefined || root.selfHosted === null
    ? undefined
    : root.selfHosted === false ? false : selfHostedTier(asObject(root.selfHosted, 'deployment.selfHosted'), env)

  return createDeployment({
    ...id !== undefined ? { id } : {},
    ...options.activeModel !== undefined ? { activeModel: options.activeModel } : {},
    ...order !== undefined ? { order } : {},
    ...native !== undefined ? { native } : {},
    ...free !== undefined ? { free } : {},
    ...selfHosted !== undefined ? { selfHosted } : {},
  })
}

/**
 * Read a config file and build the deployment.
 *
 * `node:fs` is imported here rather than at module scope, so importing this package in an
 * environment without a filesystem (a browser bundle, an edge runtime) still works as long
 * as this function is not called.
 *
 * @param path - the JSON file to read.
 * @param options - the active-model reader and the environment.
 * @returns the deployment.
 * @throws Error when the file is missing, is not valid JSON, or fails validation.
 */
export async function loadDeploymentConfigFile(path: string, options: BuildFromConfigOptions = {}): Promise<Deployment> {
  let text: string
  try {
    const fs = await import('node:fs/promises')
    text = await fs.readFile(path, 'utf8')
  } catch (error: unknown) {
    throw new Error(`could not read the deployment config at ${path}: ${String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error(`${path} is not valid JSON: ${String(error)}`)
  }
  return deploymentFromConfig(parsed, options)
}
