/**
 * Parse a comma-separated editor value only when the user commits it.
 * Spaces are valid inside a value, so they must not be treated as delimiters.
 */
export function splitDelimitedText(text: string): string[] {
  return text
    .split(/[,，、]/)
    .map((value) => value.trim())
    .filter(Boolean)
}
