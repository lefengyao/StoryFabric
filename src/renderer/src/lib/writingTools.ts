import { EditorState, type TransactionSpec } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'

export interface WordMatch { from: number; to: number }

export function findWordMatches(text: string, word: string): WordMatch[] {
  if (!word) return []
  const matches: WordMatch[] = []
  for (let from = text.indexOf(word); from !== -1; from = text.indexOf(word, from + word.length)) matches.push({ from, to: from + word.length })
  return matches
}

export function locateWordMatch(matches: WordMatch[], selection: WordMatch, direction: 1 | -1): number {
  if (!matches.length) return -1
  const current = matches.findIndex((match) => match.from === selection.from && match.to === selection.to)
  if (current !== -1) return (current + direction + matches.length) % matches.length
  if (direction === -1) {
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i].to <= selection.from) return i
    return matches.length - 1
  }
  const next = matches.findIndex((match) => match.from >= selection.to)
  return next === -1 ? 0 : next
}

/** Format prose only. Markdown block lines and all fenced contents stay intact. */
export function formatChapterText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let fence: { marker: string; length: number } | null = null
  let previousProse = false
  let listContinuation = false
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      output.push(line)
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      previousProse = false
      continue
    }
    if (!line.trim()) {
      if (output.length && output.at(-1) !== '') output.push('')
      continue
    }
    const trimmed = line.replace(/^[ \t　]+/, '')
    const setext = /^ {0,3}(?:=+|-+)[ \t]*$/
    const structure = Boolean(marker) || setext.test(line) || setext.test(lines[lineIndex + 1] ?? '') || /^(?:#{1,6}(?:\s|$)|>|[*+-]\s|\d+[.)]\s|\||(?:[-*_]\s*){3,}$|\[[^\]]+\]:|<\/?[A-Za-z!])/.test(trimmed) || (listContinuation && /^(?: {2,}|\t)/.test(line))
    const prose = !structure
    if (output.length && output.at(-1) !== '' && (prose || previousProse)) output.push('')
    output.push(prose ? `　　${trimmed.trimEnd()}` : line)
    if (marker) fence = { marker: marker[1][0], length: marker[1].length }
    listContinuation = /^(?:[*+-]\s|\d+[.)]\s)/.test(trimmed) || (listContinuation && /^(?: {2,}|\t)/.test(line))
    previousProse = prose
  }
  if (!fence) while (output.at(-1) === '') output.pop()
  return output.join('\n')
}

export function chapterFormatTransaction(state: EditorState): TransactionSpec {
  const formatted = formatChapterText(state.doc.toString())
  if (formatted === state.doc.toString()) return {}
  return {
    changes: { from: 0, to: state.doc.length, insert: formatted },
    selection: { anchor: Math.min(state.selection.main.head, formatted.length) },
    annotations: isolateHistory.of('full'),
    userEvent: 'input.format',
    scrollIntoView: true
  }
}
