/**
 * The JSON Schema for the deployment config file, generated from the validator's own rules.
 *
 * A hand-written schema would be a second implementation of the same rules, and the two drift
 * as soon as either changes — ending in a schema that offers a setting the validator rejects,
 * or that accepts the typo the schema existed to catch. So this module reads
 * {@link DEPLOYMENT_CONFIG_SCHEMA_SOURCE}, the same constants `deploymentFromConfig` enforces.
 *
 * The committed `deployment.schema.json` is produced by `scripts/export-schema.mjs`, and a test
 * regenerates it in memory and compares — so "changed the code, forgot the artifact" fails
 * rather than shipping a lying schema.
 *
 * What the schema buys: an editor offers the real keys and flags a typo before the process
 * starts, instead of at load time. What it does **not** do: resolve `*Ref` names, which depend
 * on the environment and stay a runtime concern.
 * @module web-search-standalone/deployment-schema
 */

import { DEPLOYMENT_CONFIG_SCHEMA_SOURCE } from './deployment-config'

/** A JSON Schema object, loose enough to build without a schema type library. */
export type JsonSchema = Record<string, unknown>

/** A string field. */
function stringField(description: string): JsonSchema {
  return { type: 'string', description }
}

/** A string field restricted to a fixed set. */
function enumField(values: readonly string[], description: string): JsonSchema {
  return { type: 'string', enum: [...values], description }
}

/** A positive-integer field. */
function countField(description: string): JsonSchema {
  return { type: 'integer', minimum: 1, description }
}

/** The `false` a tier accepts to switch itself off, as a schema fragment. */
const DISABLED: JsonSchema = {
  const: false,
  description: 'Set to false to leave this tier out of the deployment.',
}

/**
 * An object level: fixed properties, `_`/`$` comments allowed, everything else rejected.
 *
 * `additionalProperties: false` plus `patternProperties` for the comment prefix is exactly the
 * validator's behaviour: a typo is an error, a documentation key is not.
 */
function objectLevel(properties: Record<string, JsonSchema>, description: string): JsonSchema {
  return {
    type: 'object',
    description,
    properties,
    patternProperties: { [DEPLOYMENT_CONFIG_SCHEMA_SOURCE.commentPattern]: true },
    additionalProperties: false,
  }
}

/** The native tier. */
function nativeSchema(): JsonSchema {
  return objectLevel({
    endpoint: stringField('Full URL of the messages/responses endpoint. Adapters never append a path.'),
    endpointRef: stringField('Name of an environment variable holding the endpoint. Use instead of `endpoint`.'),
    protocol: enumField(
      DEPLOYMENT_CONFIG_SCHEMA_SOURCE.protocols,
      'Required. The provider derives its id and availability from this, so it cannot be resolved per request.',
    ),
    model: stringField('Model to send. Omit to follow the host’s active model.'),
    apiKey: stringField('The credential itself. Prefer `apiKeyRef`: this file gets committed.'),
    apiKeyRef: stringField('Name of an environment variable holding the credential. A missing variable fails at load.'),
    capability: enumField(
      DEPLOYMENT_CONFIG_SCHEMA_SOURCE.capabilities,
      'auto consults the shipped family table; always trusts the route; never disables the tier. Ignored when capableModels is present.',
    ),
    capableModels: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description: 'Glob patterns of models whose route passes the server tool through. Beats the shipped table.',
    },
    maxUses: countField('Upper bound on server-side searches per call, where the vendor supports it.'),
    maxTokens: countField('Upper bound on the answer tokens the vendor may spend.'),
  }, 'The model vendor’s own server-side search. Omit or set false to leave it out.')
}

/** The free hosted tier. */
function freeSchema(): JsonSchema {
  return objectLevel({
    profile: stringField('A shipped profile id (anysearch, exa-mcp, parallel-mcp) or a custom profile.'),
    apiKey: stringField('The credential itself. Prefer `apiKeyRef`.'),
    apiKeyRef: stringField('Name of an environment variable holding the credential.'),
    wireMaxResults: countField('Result cap requested from the service, before this package’s own capping.'),
  }, 'A free hosted search service, reached over MCP. Omit or set false to leave it out.')
}

/** Your own deployment. */
function selfHostedSchema(): JsonSchema {
  return objectLevel({
    baseURL: stringField('Service base URL, e.g. https://search.example.com.'),
    token: stringField('The bearer token itself. Prefer `tokenRef`.'),
    tokenRef: stringField('Name of an environment variable holding the bearer token.'),
    searchPath: stringField('Override the search path. Defaults to /v1/search.'),
    extractPath: stringField('Override the extraction path. Defaults to /v1/extract.'),
    mode: enumField(
      DEPLOYMENT_CONFIG_SCHEMA_SOURCE.modes,
      'static fetches once; render loads the page in headless Chromium first; auto escalates only when the static read was too thin.',
    ),
    maxContentChars: countField('Body cap requested from the service.'),
  }, 'Your own deployment: the Web Content Service. Omit or set false to leave it out.')
}

/**
 * Build the schema for a deployment config file.
 *
 * @returns a JSON Schema (draft 2020-12) describing `deploymentFromConfig`'s accepted input.
 */
export function deploymentConfigSchema(): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/tvytlx/web-search-kit/deployment.schema.json',
    title: 'Web search deployment',
    description: [
      'How this deployment reaches web search: the vendor’s own server-side tool, a free hosted',
      'service, your own server, or some order of those. Generated from the validator’s own rules',
      'by scripts/export-schema.mjs — do not edit by hand.',
      '',
      'Secrets are named, not embedded: a `*Ref` field holds the NAME of an environment variable,',
      'resolved when the deployment is built. A named variable that is missing is an error at load',
      'time, not at the first search.',
    ].join(' '),
    oneOf: [
      objectLevel({
        id: stringField('Namespace for the registered provider ids. Defaults to "deployment".'),
        order: {
          oneOf: [
            enumField(DEPLOYMENT_CONFIG_SCHEMA_SOURCE.presets, 'A named preference order. Tiers you did not configure are dropped from it.'),
            {
              type: 'array',
              items: enumField(DEPLOYMENT_CONFIG_SCHEMA_SOURCE.tiers, 'A tier id.'),
              description: 'An explicit preference order. Naming a tier you did not configure is an error.',
            },
          ],
          description: 'Which tiers to prefer, in order. A preset states a preference; an array states a plan.',
        },
        native: { oneOf: [nativeSchema(), DISABLED] },
        free: { oneOf: [freeSchema(), DISABLED] },
        selfHosted: { oneOf: [selfHostedSchema(), DISABLED] },
      }, 'A web search deployment.'),
      {
        description: 'Comment-only object, which the loader ignores.',
        type: 'object',
        patternProperties: { [DEPLOYMENT_CONFIG_SCHEMA_SOURCE.commentPattern]: true },
        additionalProperties: false,
      },
    ],
  }
}
