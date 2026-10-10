/**
 * Structural ports of the DeepSeek Harness tool-presentation types this package
 * produces. They carry no framework dependency: a UI (or a host that renders
 * tool cards) narrows them and draws them. Names and fields match
 * `@deepseek-ai/dsh-tools` presentation types so a port stays mechanical.
 * @module web-search-standalone/presentation
 */

/** JSON-compatible value, the type of persisted result metadata. */
export type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/**
 * One citeable source as a UI needs it. Structurally a `WebSearchSource`. A type
 * alias rather than an interface so it keeps the implicit index signature that
 * makes it assignable to {@link JsonValue}, which persisted metadata requires.
 */
export type WebSource = {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

/** Pending-call card shown while a tool call runs. */
export interface GenericCallView {
  readonly card: 'generic'
  readonly title: string
  /** Discriminant the host uses to pick an icon or grouping; `search` for this tool. */
  readonly kind: string
  readonly rawInput: string
}

/** Completed-call card carrying the faithful structured search sources. */
export interface WebSearchResultView {
  readonly card: 'web'
  readonly kind: 'search'
  readonly title: string
  readonly sources: readonly WebSource[]
  readonly truncated: boolean
  readonly answer?: string
}

/** The result facts a completed-call presenter reads. */
export interface ToolResult {
  readonly isError: boolean
  /** Opaque persisted metadata; narrow it with `searchMetaFromResult`. */
  readonly meta?: unknown
}
