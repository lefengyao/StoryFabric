import { dump, load } from 'js-yaml'

export interface ParsedFrontMatter {
  data: Record<string, unknown>
  content: string
}

const FRONT_MATTER = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function metadataObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('front matter 必须是 YAML 对象')
  return value as Record<string, unknown>
}

/** Parses YAML front matter only; executable JavaScript front matter is unsupported. */
export function parseFrontMatter(input: string): ParsedFrontMatter {
  const match = FRONT_MATTER.exec(input)
  if (!match) return { data: {}, content: input }
  return { data: metadataObject(load(match[1])), content: input.slice(match[0].length) }
}

/** Serializes the workspace metadata using YAML and never emits executable front matter. */
export function stringifyFrontMatter(content: string, data: Record<string, unknown>): string {
  const yaml = dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })
  return `---\n${yaml}---\n\n${content}`
}
