import { ChangeSet, EditorState, type ChangeSpec, type Text } from '@codemirror/state'
import { externalEditorChange } from './editorChange'

export interface ChapterEnterChange {
  from: number
  to: number
  insert: string
  cursor: number
}

const FIRST_LINE_INDENT = '　　'
const FENCE_LINE = /^(`{3,}|~{3,})(.*)$/
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
  let fence: { marker: '`' | '~'; length: number } | null = null
  let offset = 0
  for (const line of text.split('\n')) {
    if (offset >= lineStart) break
    const match = FENCE_LINE.exec(line.replace(/^[ \t　]*/, ''))
    if (match) {
      const marker = match[1][0] as '`' | '~'
      if (!fence) fence = { marker, length: match[1].length }
      else if (marker === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = null
    }
    offset += line.length + 1
  }
  return fence !== null
}

function lineEnd(text: string, start: number): number {
  const end = text.indexOf('\n', start)
  return end === -1 ? text.length : end
}

/** Format a newly typed prose paragraph in the same undo step as the input. */
export const chapterInputFormatting = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || !transaction.isUserEvent('input.type') || transaction.isUserEvent('input.type.compose') || transaction.annotation(externalEditorChange)) return transaction

  const changes: ChangeSpec[] = []
  const seen = new Set<number>()
  transaction.changes.iterChangedRanges((fromA, _toA, fromB, toB) => {
    if (fromB === toB) return
    const before = transaction.startState.doc.lineAt(fromA)
    const line = transaction.newDoc.lineAt(fromB)
    // Existing content, manual indentation and Markdown openers keep their format.
    if (before.text.trim() || seen.has(line.from)) return
    const indent = chapterParagraphIndent(transaction.newDoc, line.from)
    if (!indent) return
    seen.add(line.from)
    changes.push(indent)
  })
  if (!changes.length) return transaction
  const changeSet = ChangeSet.of(changes, transaction.newDoc.length)
  return [transaction, {
    changes: changeSet,
    selection: transaction.newSelection.map(changeSet),
    sequential: true
  }]
})

/** Used after normal typing or after the IME finishes replacing its preedit text. */
export function chapterParagraphIndent(doc: Text, position: number): ChangeSpec | null {
  const line = doc.lineAt(position)
  if (leadingIndent(line.text) || !isProseLine(line.text) || /^[#>*+`~|_-]/.test(line.text) || /^\d+[.)](?:\s|$)/.test(line.text)) return null
  if (line.from > 0 && isInsideFence(doc.toString(), line.from)) return null
  return { from: line.from, insert: FIRST_LINE_INDENT }
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
