import { useEffect, useRef, useState } from 'react'

const AUTO_SCROLL_INTERVAL_MS = 50

export function isConversationAtBottom(element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80
}
export function useChatScroll(sessionId: string | null, content: unknown): {
  scrollRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
  unseen: boolean
  toLatest: () => void
} {
  const scrollRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const lastAutoScrollAt = useRef(0)
  const pendingAutoScroll = useRef<number | null>(null)
  const [unseen, setUnseen] = useState(false)
  const scrollToLatest = (): void => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    lastAutoScrollAt.current = performance.now()
  }
  const toLatest = (): void => {
    follow.current = true
    setUnseen(false)
    if (pendingAutoScroll.current !== null) {
      window.clearTimeout(pendingAutoScroll.current)
      pendingAutoScroll.current = null
    }
    scrollToLatest()
  }
  useEffect(() => { toLatest() }, [sessionId])
  useEffect(() => {
    if (!scrollRef.current) return
    if (!follow.current) {
      setUnseen(true)
      return
    }

    const elapsed = performance.now() - lastAutoScrollAt.current
    if (elapsed >= AUTO_SCROLL_INTERVAL_MS) {
      scrollToLatest()
      return
    }
    if (pendingAutoScroll.current !== null) return
    pendingAutoScroll.current = window.setTimeout(() => {
      pendingAutoScroll.current = null
      if (follow.current) scrollToLatest()
    }, AUTO_SCROLL_INTERVAL_MS - elapsed)
  }, [content])
  useEffect(() => () => {
    if (pendingAutoScroll.current !== null) window.clearTimeout(pendingAutoScroll.current)
  }, [])
  return { scrollRef, unseen, toLatest, onScroll: () => { if (scrollRef.current) { follow.current = isConversationAtBottom(scrollRef.current); if (follow.current) setUnseen(false) } } }
}
