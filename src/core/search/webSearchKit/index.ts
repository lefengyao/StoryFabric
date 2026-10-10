/**
 * Standalone web search: a provider seam (`WebSearchRuntime` + providers) and the
 * model-facing `web_search` tool, with zero runtime dependencies. Extracted from
 * DeepSeek Harness `packages/web/{web,tool-web,web-search-*}` (MIT).
 * @module web-search-standalone
 */

export {
  INVALID_ARGS,
  TOOL_TIMEOUT,
  WEB_ABORTED,
  WEB_DUPLICATE_PROVIDER,
  WEB_PROVIDER_AMBIGUOUS,
  WEB_PROVIDER_CONFIGURED_MISSING,
  WEB_PROVIDER_CONFIGURED_UNAVAILABLE,
  WEB_PROVIDER_CREDENTIAL_MISSING,
  WEB_PROVIDER_ERROR,
  WEB_PROVIDER_UNAVAILABLE,
  WEB_UNSUPPORTED_OPERATION,
  WebError,
} from './types'
export type {
  WebExtractRequest,
  WebExtractResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types'

export { WebSearchRuntime, capSources } from './runtime'
export type { ProviderSelector, SearchRunner, WebSearchRuntimeConfig } from './runtime'

export {
  fallbackSearchProvider,
  NON_FAILOVER_CODES,
} from './providers/fallback'
export type { FallbackSearchProviderOptions } from './providers/fallback'

export {
  ANTHROPIC_WEB_SEARCH_VERSION,
  ANTHROPIC_WEB_SEARCH_VERSION_DYNAMIC,
  NATIVE_DEFAULT_MAX_TOKENS,
  NATIVE_DEFAULT_MAX_USES,
  NativeSearchProvider,
  anthropicMessagesAdapter,
  nativeSearchProvider,
  openaiResponsesAdapter,
  resolveNativeProtocol,
} from './providers/native'
export type {
  AnthropicMessagesAdapterOptions,
  NativeProtocolAdapter,
  NativeProtocolContext,
  NativeRequestRecord,
  NativeSearchProviderOptions,
  OpenAIResponsesAdapterOptions,
} from './providers/native'

export {
  cleanUrl,
  dedupeSources,
  sourcesFromRecords,
  sourcesFromText,
  sourcesFromValue,
} from './providers/text-sources'

export {
  ANYSEARCH_PROFILE,
  EXA_MCP_PROFILE,
  MCP_PROFILES,
  PARALLEL_MCP_PROFILE,
  resolveProfile,
} from './providers/mcp-profiles'
export type {
  McpAuthSpec,
  McpProfileRef,
  McpSearchLimits,
  McpSearchProfile,
} from './providers/mcp-profiles'

export {
  MCP_DEFAULT_WIRE_MAX_RESULTS,
  McpSearchProvider,
  mcpSearchProvider,
  parseMcpEnvelope,
  parseSearchText,
} from './providers/mcp'
export type { McpRequestRecord, McpSearchProviderOptions } from './providers/mcp'

export {
  DEFAULT_EXTRACT_MAX_CONTENT_CHARS,
  DEFAULT_EXTRACT_TOOL_TIMEOUT_MS,
  EXTRACT_TOOL_NAME,
  assertPublicHttpUrl,
  createExtractTool,
} from './extract-tool'
export type { ExtractToolExecution, WebExtractTool, WebExtractToolOptions } from './extract-tool'

export {
  EXTERNAL_WEB_CONTENT_NOTICE,
  WEB_SEARCH_MAX_QUERIES,
  WEB_SEARCH_MAX_RESULTS,
  formatSearchOutput,
  mergeSearchResults,
  parseSearchArgs,
  presentSearchCall,
  presentSearchResult,
  projectSource,
  runSearchQueries,
  searchMetaFromResult,
  searchMetaFromValue,
} from './search'
export type { WebSearchArgs, WebSearchMeta } from './search'

export {
  DEFAULT_SEARCH_TOOL_TIMEOUT_MS,
  SEARCH_TOOL_NAME,
  createSearchTool,
  searchToolGuidance,
  searchToolOutputSchema,
  searchToolParameters,
  validateSearchArgs,
} from './tool'
export type { TextBlock, ToolExecution, WebSearchTool, WebSearchToolOptions } from './tool'

export type {
  GenericCallView,
  JsonValue,
  ToolResult,
  WebSearchResultView,
  WebSource,
} from './presentation'

export {
  DEEPSEEK_DEFAULT_API_KEY_REF,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PROVIDER_ID,
  DeepSeekSearchProvider,
  citationSnippets,
  deepseekSearchProvider,
  mapAnthropicResponse,
} from './providers/deepseek'
export type {
  AnthropicError,
  AnthropicResponse,
  DeepSeekSearchOptions,
  DeepSeekSearchRequest,
} from './providers/deepseek'

export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
  exaSearchProvider,
  mapExaResponse,
  mapExaResult,
} from './providers/exa'
export type { ExaError, ExaResult, ExaSearchOptions, ExaSearchRequest, ExaSearchResponse } from './providers/exa'

export {
  PERPLEXITY_DEFAULT_BASE_URL,
  PERPLEXITY_DEFAULT_MAX_TOKENS,
  PERPLEXITY_DEFAULT_MODEL,
  PERPLEXITY_PROVIDER_ID,
  PerplexitySearchProvider,
  mapPerplexityResponse,
  mapPerplexityResult,
  perplexitySearchProvider,
} from './providers/perplexity'
export type {
  PerplexityError,
  PerplexityRecency,
  PerplexityResponse,
  PerplexitySearchOptions,
  PerplexitySearchResult,
} from './providers/perplexity'

export {
  SEARXNG_DEFAULT_BASE_URL,
  SEARXNG_DEFAULT_MAX_CONCURRENCY,
  SEARXNG_DEFAULT_MIN_INTERVAL_MS,
  SEARXNG_NO_UPSTREAM,
  SEARXNG_PROVIDER_ID,
  SearxngSearchProvider,
  mapSearxngResponse,
  mapSearxngResult,
  searxngSearchProvider,
  unresponsiveSummary,
} from './providers/searxng'
export type { SearxngResponse, SearxngResult, SearxngSearchOptions, SearxngTimeRange } from './providers/searxng'

export {
  READABLE_DEFAULT_EXTRACT_PATH,
  READABLE_DEFAULT_FIRECRAWL_BASE_URL,
  READABLE_DEFAULT_MAX_CONCURRENCY,
  READABLE_DEFAULT_MIN_INTERVAL_MS,
  READABLE_DEFAULT_PLAIN_BASE_URL,
  READABLE_DEFAULT_SCRAPE_PATH,
  READABLE_PROVIDER_ID,
  ReadableExtractProvider,
  emptyExtractionMessage,
  mapFirecrawlResponse,
  mapPlainExtractResponse,
  readableExtractProvider,
} from './providers/readable'
export type {
  FirecrawlResponse,
  PlainExtractResponse,
  ReadableDialect,
  ReadableExtractOptions,
} from './providers/readable'

export {
  DEFAULT_TIER_ORDER,
  NATIVE_SEARCH_FAMILIES,
  TIER_PRESETS,
  createDeployment,
  nativeProtocolFor,
  nativeVendorFor,
  resolveTierOrder,
} from './deployment'
export type {
  Deployment,
  DeploymentConfig,
  FreeTierConfig,
  NativeCapability,
  NativeFamily,
  NativeProtocolName,
  NativeTierConfig,
  SelfHostedTierConfig,
  TierId,
  TierPreset,
} from './deployment'

export { DEPLOYMENT_CONFIG_SCHEMA_SOURCE, deploymentFromConfig, globPredicate, loadDeploymentConfigFile } from './deployment-config'
export type { BuildFromConfigOptions, Environment } from './deployment-config'

export { deploymentConfigSchema } from './deployment-schema'
export type { JsonSchema } from './deployment-schema'

export { deploymentHealth } from './deployment-health'
export type { DeploymentHealth, DeploymentHealthOptions, HealthStatus, HealthTier } from './deployment-health'

export {
  WEBCONTENT_DEFAULT_BASE_URL,
  WEBCONTENT_DEFAULT_EXTRACT_PATH,
  WEBCONTENT_DEFAULT_SEARCH_PATH,
  WEBCONTENT_PROVIDER_ID,
  WebContentProvider,
  mapWebContentExtract,
  mapWebContentSearch,
  webContentProvider,
} from './providers/webcontent'
export type { WebContentMode, WebContentProviderOptions } from './providers/webcontent'

export { RequestGate, USER_AGENT, sleep } from './providers/shared'
export type { FetchLike, OptionsSource } from './providers/shared'
