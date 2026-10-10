/**
 * A health payload for a deployment, ready to serve from whatever the host already uses.
 *
 * A library cannot open a port, so this returns **data** — the host returns it from its own
 * `/health`, job, or status page:
 *
 * ```ts
 * import { deploymentHealth } from 'web-search-standalone'
 *
 * app.get('/health/web-search', () => deploymentHealth(deployment, { model: agent.activeModel }))
 * ```
 *
 * Three properties this module is built around, each because getting it wrong makes the endpoint
 * worse than useless:
 *
 * 1. **No secrets, ever.** The payload names providers and reports booleans. A health endpoint
 *    tends to be the least protected route in an application and is often pasted into tickets, so
 *    a token that leaks out of it leaks widely. A test serializes the payload and looks for the
 *    configured credentials.
 * 2. **No outbound requests.** Health endpoints get polled. Anything that probes a backend on
 *    each poll will eventually get the backend to rate-limit you, from the monitoring system, and
 *    the symptom will look like the backend being flaky. This reports **configuration**
 *    readiness; use {@link Deployment.probe} deliberately, once, and the self-hosted service's own
 *    `/v1/health` for its liveness.
 * 3. **A status that distinguishes "broken" from "working as designed".** A model with no
 *    server-side search is not a degraded deployment — it is the normal case that the free or
 *    self-hosted tier exists for. Only a tier that is *supposed* to serve this model and cannot is
 *    worth a page.
 * @module web-search-standalone/deployment-health
 */

import type { Deployment, TierId } from './deployment'

/** How a deployment is doing. */
export type HealthStatus =
  /** The preferred tier for this model is ready. */
  | 'ok'
  /** Search works, but not through the tier that should have served it. */
  | 'degraded'
  /** No tier can serve a request. */
  | 'unavailable'

/** One tier's state, as reported. */
export interface HealthTier {
  readonly tier: TierId
  readonly id: string
  /** The tier is configured correctly: endpoint, credential, path. */
  readonly ready: boolean
  /** This model's chain reaches the tier. */
  readonly usable: boolean
}

/** The health payload. JSON-serializable, stable, and free of credentials. */
export interface DeploymentHealth {
  readonly status: HealthStatus
  readonly deployment: string
  /** The model this report is for, or `null` when none is known. */
  readonly model: string | null
  /** The provider id the runtime is configured with for this model. */
  readonly chain: string
  readonly tiers: readonly HealthTier[]
  readonly native: {
    readonly configured: boolean
    readonly capable: boolean
    /** True when the capability came from a probe rather than local reasoning. */
    readonly probed: boolean
    readonly reason: string
  }
  /** What to look at, when the status is not `ok`. Empty when it is. */
  readonly notes: readonly string[]
  /** When this report was produced, as an ISO 8601 string. */
  readonly checkedAt: string
}

/** Options for {@link deploymentHealth}. */
export interface DeploymentHealthOptions {
  /** The model to report for; defaults to the deployment's configured reader. */
  readonly model?: string
  /** Injectable clock, so a test can assert the timestamp. */
  readonly now?: () => Date
}

/** A hint about what to check for a tier that is not ready. Never a claim about what is wrong. */
const READINESS_HINTS: Readonly<Record<TierId, string>> = {
  native: 'check the endpoint, the protocol, and the credential the apiKeyRef names',
  free: 'check the profile and the credential the apiKeyRef names, if the profile needs one',
  'self-hosted': 'check that the service is up, and that the baseURL, paths, and tokenRef are right',
}

/**
 * Summarise a deployment's state.
 *
 * @param deployment - the deployment to report on.
 * @param options - the model to report for, and an optional clock.
 * @returns the payload. The same input always produces the same shape, so a monitor can diff it.
 */
export function deploymentHealth(deployment: Deployment, options: DeploymentHealthOptions = {}): DeploymentHealth {
  const snapshot = deployment.inspect(options.model)
  const now = (options.now ?? ((): Date => new Date()))()

  const tiers: HealthTier[] = snapshot.providers.map(entry => ({
    tier: entry.tier,
    id: entry.id,
    ready: entry.ready,
    usable: entry.usable,
  }))

  // Only the tiers this model's chain actually reaches matter for the verdict: a tier left out by
  // routing is not a problem, which is what keeps "this model has no native search" from being
  // reported as a fault.
  const inChain = tiers.filter(entry => entry.usable)
  const readyInChain = inChain.filter(entry => entry.ready)
  const unreadyInChain = inChain.filter(entry => !entry.ready)
  const preferred = unreadyInChain[0]

  const status: HealthStatus = readyInChain.length === 0
    ? 'unavailable'
    : preferred !== undefined
      ? 'degraded'
      : 'ok'

  const notes: string[] = []
  if (status === 'unavailable') {
    notes.push(
      inChain.length === 0
        ? 'no tier is reachable for this model, so search will fail; check the deployment configuration'
        : `no tier this model can reach is ready (${inChain.map(entry => entry.tier).join(', ')}), so search will fail; `
          + READINESS_HINTS[inChain[0]?.tier ?? 'free'],
    )
  } else if (status === 'degraded' && preferred !== undefined) {
    notes.push(
      `the ${preferred.tier} tier is not ready, so requests fall through to ${readyInChain[0]?.tier ?? 'a later tier'}; `
      + READINESS_HINTS[preferred.tier],
    )
  }
  // Later unready tiers in the chain are worth naming too, but as information: the chain will
  // simply skip past them, and the caller may want to know the redundancy is not there.
  for (const entry of unreadyInChain.slice(1)) {
    notes.push(`the ${entry.tier} tier is also not ready and will be skipped; ${READINESS_HINTS[entry.tier]}`)
  }

  return {
    status,
    deployment: snapshot.id,
    model: snapshot.model ?? null,
    chain: snapshot.chain,
    tiers,
    native: {
      configured: snapshot.native.configured,
      capable: snapshot.native.capable,
      probed: snapshot.native.probed,
      reason: snapshot.native.reason,
    },
    notes,
    checkedAt: now.toISOString(),
  }
}
