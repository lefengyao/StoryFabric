import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { chatInputHeight } from '../../lib/chatInputSizing'

/** Android drafts resize inside their chat column; desktop keeps its existing textarea sizing. */
export function useChatInputAutosize(value: string, enabled: boolean, fontSize?: number): RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const resize = useCallback(() => {
    const input = ref.current
    if (!enabled || !input) return
    const column = input.closest<HTMLElement>('[data-chat-column]')
    if (!column?.clientHeight) return
    const style = getComputedStyle(input)
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const minimum = Math.max(parseFloat(style.minHeight) || 30, parseFloat(style.lineHeight) + padding)
    // Reset before measuring so deleting text also shrinks the input.
    input.style.height = '0px'
    const contentHeight = input.value ? input.scrollHeight : minimum
    input.style.height = `${chatInputHeight(contentHeight, minimum, column.clientHeight)}px`
  }, [enabled])

  useLayoutEffect(resize, [resize, value, fontSize])
  useLayoutEffect(() => {
    if (!enabled) return
    const column = ref.current?.closest<HTMLElement>('[data-chat-column]')
    if (!column) return
    const observer = new ResizeObserver(resize)
    observer.observe(column)
    window.addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [enabled, resize])

  return ref
}
