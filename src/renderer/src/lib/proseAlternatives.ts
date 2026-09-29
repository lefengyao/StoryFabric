export interface ProseAlternative {
  id: string
  title: string
  content: string
}

const HEADING = /^#{2,4}\s*(?:方案|候选方案)\s*([一二三四五六七八九十0-9]+)?(?:\s*[:：-]\s*([^\n]+))?\s*$/gm

/** Reads the explicit candidate format requested by the generation prompt. */
export function parseProseAlternatives(text: string): ProseAlternative[] {
  const matches = [...text.matchAll(HEADING)]
  if (matches.length < 2) return []
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length
    const title = match[2]?.trim() || `方案 ${match[1] || index + 1}`
    const content = text.slice(start, end).trim()
    return { id: `alternative-${index + 1}`, title, content }
  }).filter((item) => item.content.length > 0)
}
