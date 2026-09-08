const FIRST_LINE_INDENT = '　　'
const FENCE_LINE = /^ {0,3}(?:```|~~~)/
const MARKDOWN_STRUCTURE_LINE = /^ {0,3}(?:#{1,6}(?:\s|$)|>\s?|[*+-]\s|\d+[.)]\s)/

/** 为章节正文段落添加中文写作习惯的全角首行缩进，不改动 Markdown 结构行。 */
export function normalizeChapterContent(input: string): string {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  let inFence = false

  return lines
    .map((line, index) => {
      if (FENCE_LINE.test(line)) {
        inFence = !inFence
        return line
      }
      if (!line.trim() || inFence || MARKDOWN_STRUCTURE_LINE.test(line)) return line
      if (line.startsWith(FIRST_LINE_INDENT) || /^[ \t]/.test(line)) return line
      if (index === 0 || !lines[index - 1]?.trim()) return `${FIRST_LINE_INDENT}${line}`
      return line
    })
    .join('\n')
}
