export interface ChapterEnterChange {
  from: number
  to: number
  insert: string
  cursor: number
}

const FIRST_LINE_INDENT = '　　'
const FENCE_LINE = /^(?:```|~~~)/
const MARKDOWN_STRUCTURE_LINE = /^(?:#{1,6}(?:\s|$)|>\s?|[*+-]\s|\d+[.)]\s)/

function isProseLine(line: string): boolean {
  const content = line.replace(/^[ \t　]*/, '')
  return Boolean(content.trim()) && !FENCE_LINE.test(content) && !MARKDOWN_STRUCTURE_LINE.test(content)
}

function isStructureLine(line: string): boolean {
  const content = line.replace(/^[ \t　]*/, '')
  return Boolean(content.trim()) && (FENCE_LINE.test(content) || MARKDOWN_STRUCTURE_LINE.test(content))
}

function leadingIndent(line: string): string {
  return line.match(/^[ \t　]*/)?.[0] ?? ''
}

function isInsideFence(text: string, lineStart: number): boolean {
  let inFence = false
  let offset = 0
  for (const line of text.split('\n')) {
    if (offset >= lineStart) break
    if (FENCE_LINE.test(line.replace(/^[ \t　]*/, ''))) inFence = !inFence
    offset += line.length + 1
  }
  return inFence
}

function lineEnd(text: string, start: number): number {
  const end = text.indexOf('\n', start)
  return end === -1 ? text.length : end
}

/**
 * Returns the text change for a chapter paragraph break, or null when the
 * current line is Markdown structure that should keep CodeMirror's default
 * Enter behavior.
 */
export function applyChapterEnter(text: string, from: number, to: number): ChapterEnterChange | null {
  const start = Math.max(0, Math.min(from, text.length))
  const end = Math.max(start, Math.min(to, text.length))
  const currentLineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const currentLineEnd = lineEnd(text, currentLineStart)
  if (isInsideFence(text, currentLineStart) || !isProseLine(text.slice(currentLineStart, currentLineEnd))) return null

  let changeTo = end
  let insert = `\n\n${FIRST_LINE_INDENT}`
  let cursor = start + insert.length

  // If the user is at the end of a line that already has a normal newline,
  // upgrade that break in place instead of leaving an unindented paragraph.
  if (start === end && start === currentLineEnd && text[start] === '\n') {
    let nextParagraphStart = start
    while (text[nextParagraphStart] === '\n') nextParagraphStart += 1
    if (nextParagraphStart > start + 1) {
      const nextParagraphEnd = lineEnd(text, nextParagraphStart)
      const nextParagraph = text.slice(nextParagraphStart, nextParagraphEnd)
      if (isStructureLine(nextParagraph)) {
        return { from: start, to: nextParagraphStart, insert: '\n\n', cursor: start + 2 }
      }
      const existingIndent = leadingIndent(nextParagraph)
      const nextIndent = existingIndent || FIRST_LINE_INDENT
      changeTo = nextParagraphStart + existingIndent.length
      insert = `\n\n${nextIndent}`
      cursor = start + insert.length
    } else {
      const nextLineStart = start + 1
      const nextLineEnd = lineEnd(text, nextLineStart)
      const nextLine = text.slice(nextLineStart, nextLineEnd)
      changeTo = start + 1
      const existingIndent = leadingIndent(nextLine)
      if (isStructureLine(nextLine)) {
        insert = '\n\n'
        cursor = start + insert.length
      } else if (existingIndent) {
        changeTo = nextLineStart + existingIndent.length
        insert = `\n\n${existingIndent}`
        cursor = start + insert.length
      }
    }
  }

  return { from: start, to: changeTo, insert, cursor }
}
