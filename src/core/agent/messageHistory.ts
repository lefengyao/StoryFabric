import type { ChatMessage } from '../../shared/types'

const ORPHANED_TOOL_MESSAGE = '工具调用未完成：上一次运行在返回工具结果前中断，请重新执行该调用。'

const DUPLICATE_CHAPTER_PAGE_NOTICE = '同一章节版本和页码已经读取过；请使用前一次 get_chapter 结果中的 content。'

export function chapterReadMemoKey(argsJson: string): string | null {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null
    if (typeof args.chapterId !== 'string' || !args.chapterId.trim()) return null
    return JSON.stringify({
      chapterId: args.chapterId,
      offset: typeof args.offset === 'number' ? args.offset : 0,
      maxChars: typeof args.maxChars === 'number' ? args.maxChars : 8000,
      expectedRevision: typeof args.expectedRevision === 'string' ? args.expectedRevision : ''
    })
  } catch {
    return null
  }
}

function chapterReadArgs(argsJson: string): { chapterId: string; offset: number; maxChars: number; expectedRevision: string } | null {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null
    return {
      chapterId: typeof args.chapterId === 'string' ? args.chapterId : '',
      offset: typeof args.offset === 'number' ? args.offset : 0,
      maxChars: typeof args.maxChars === 'number' ? args.maxChars : 8000,
      expectedRevision: typeof args.expectedRevision === 'string' ? args.expectedRevision : ''
    }
  } catch {
    return null
  }
}

export function rememberChapterReadMemo(memo: Map<string, string>, key: string, text: string): void {
  memo.set(key, text)
}

export function findChapterReadMemo(memo: Map<string, string>, argsJson: string): string | undefined {
  const request = chapterReadArgs(argsJson)
  if (!request?.chapterId) return undefined
  const key = chapterReadMemoKey(argsJson)
  if (!key) return undefined
  const direct = memo.get(key)
  if (direct) return direct

  for (const [storedKey, text] of memo) {
    let storedRequest: ReturnType<typeof chapterReadArgs> = null
    try { storedRequest = JSON.parse(storedKey) as ReturnType<typeof chapterReadArgs> } catch { /* Ignore malformed memo keys. */ }
    if (!storedRequest || storedRequest.chapterId !== request.chapterId || storedRequest.offset !== request.offset || storedRequest.maxChars !== request.maxChars) continue
    try {
      const page = JSON.parse(text) as Record<string, unknown>
      if (page.offset !== request.offset) continue
      if (page.id !== request.chapterId) continue
      if (request.expectedRevision && page.writeRevision !== request.expectedRevision) continue
      return text
    } catch { /* Ignore malformed cached results. */ }
  }
  return undefined
}

export function compactChapterReadText(text: string, reusedToolCallId = 'previous get_chapter'): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.deduplicated === true ||
      typeof parsed.id !== 'string' || typeof parsed.writeRevision !== 'string' || typeof parsed.offset !== 'number' ||
      typeof parsed.returnedChars !== 'number' || typeof parsed.totalChars !== 'number' || typeof parsed.content !== 'string') return null
    return JSON.stringify({
      ...parsed,
      content: DUPLICATE_CHAPTER_PAGE_NOTICE,
      deduplicated: true,
      reusedToolCallId
    })
  } catch {
    return null
  }
}

/**
 * Repeated chapter reads are easy for a model to issue while it is deciding
 * how to edit. Keeping every full page in the live prompt and persisted
 * session multiplies memory use without adding evidence. A page is safe to
 * compact only when the reader reported the same chapter id, revision, offset
 * and length; a new revision or page is always retained in full.
 */
export function compactRepeatedReadResults(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Map<string, string>()
  let changed = false
  const compacted = messages.map((message) => {
    if (message.role !== 'tool' || message.toolName !== 'get_chapter' || message.isError || !message.text) return message

    let page: Record<string, unknown>
    try {
      const parsed = JSON.parse(message.text) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return message
      page = parsed as Record<string, unknown>
    } catch {
      return message
    }

    if (page.deduplicated === true || typeof page.id !== 'string' || typeof page.writeRevision !== 'string' ||
      typeof page.offset !== 'number' || typeof page.returnedChars !== 'number' || typeof page.totalChars !== 'number' ||
      typeof page.content !== 'string') return message

    const key = [page.id, page.writeRevision, page.offset, page.returnedChars, page.totalChars].join('|')
    const firstToolCallId = seen.get(key)
    if (!firstToolCallId) {
      seen.set(key, message.toolCallId ?? message.id)
      return message
    }

    const compactedText = compactChapterReadText(message.text, firstToolCallId)
    if (!compactedText) return message
    changed = true
    return { ...message, text: compactedText }
  })

  return changed ? compacted : messages
}

/**
 * Prevent a failed run from poisoning the next provider request with an
 * assistant tool-call message that has no matching tool result.
 */
export function repairOrphanedToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const repaired: ChatMessage[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'tool') {
      repaired.push({
        id: `${message.id}_repair_orphan`,
        role: 'assistant',
        text: `历史中发现脱离工具调用的结果，已隔离：${message.text ?? ''}`,
        isError: true
      })
      continue
    }
    repaired.push(message)
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue

    const expected = new Map(message.toolCalls.map((toolCall) => [toolCall.id, toolCall]))
    const responses = new Map<string, ChatMessage>()
    const misplaced: ChatMessage[] = []
    let nextIndex = index + 1
    while (nextIndex < messages.length && messages[nextIndex]?.role === 'tool') {
      const toolMessage = messages[nextIndex]
      if (toolMessage.toolCallId && expected.has(toolMessage.toolCallId) && !responses.has(toolMessage.toolCallId)) responses.set(toolMessage.toolCallId, toolMessage)
      else misplaced.push(toolMessage)
      nextIndex += 1
    }

    for (const toolCall of message.toolCalls) {
      repaired.push(responses.get(toolCall.id) ?? {
          id: `${message.id}_repair_${toolCall.id}`,
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          text: ORPHANED_TOOL_MESSAGE,
          isError: true
        })
    }
    for (const toolMessage of misplaced) {
      repaired.push({
        id: `${toolMessage.id}_repair_misplaced`,
        role: 'assistant',
        text: `历史中发现位置异常的工具结果，已从本轮工具消息中隔离：${toolMessage.text ?? ''}`,
        isError: true
      })
    }
    index = nextIndex - 1
  }

  return repaired
}
