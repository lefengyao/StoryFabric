/** Stable, platform-independent content revision for tool baselines and search cursors. */
export function resourceRevision(...parts: Array<string | number | boolean | null | undefined>): string {
  const input = parts.map((part) => part === undefined || part === null ? '' : String(part)).join('\u001f')
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `r1-${(hash >>> 0).toString(36)}-${input.length.toString(36)}`
}

export function contentRevision(content: string): string {
  return resourceRevision(content)
}
