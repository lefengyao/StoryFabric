import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyPlainText, readPlainText } from '../../lib/clipboard'
import { clampContextMenuPosition } from '../../lib/contextMenuPosition'

interface SelectionSnapshot {
  element: HTMLElement | null
  editable: boolean
  start: number | null
  end: number | null
  range: Range | null
  selectedText: string
}

interface MenuState {
  x: number
  y: number
  snapshot: SelectionSnapshot
}

const EDITABLE_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number'])

function isEditableElement(element: HTMLElement | null): boolean {
  if (!element) return false
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  if (element instanceof HTMLInputElement) return !element.disabled && !element.readOnly && EDITABLE_INPUT_TYPES.has(element.type)
  return element.isContentEditable
}

function findEditableElement(target: EventTarget | null): HTMLElement | null {
  let element = target instanceof Element ? target as HTMLElement : null
  while (element) {
    if (isEditableElement(element)) return element
    element = element.parentElement
  }
  return null
}

function snapshotSelection(target: EventTarget | null): SelectionSnapshot {
  const element = findEditableElement(target)
  const range = typeof window !== 'undefined' && window.getSelection()?.rangeCount
    ? window.getSelection()!.getRangeAt(0).cloneRange()
    : null
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart
    const end = element.selectionEnd
    return {
      element,
      editable: true,
      start,
      end,
      range: null,
      selectedText: start !== null && end !== null ? element.value.slice(start, end) : ''
    }
  }
  return {
    element,
    editable: isEditableElement(element),
    start: null,
    end: null,
    range,
    selectedText: range?.toString() ?? ''
  }
}

function restoreSelection(snapshot: SelectionSnapshot, selection?: { start: number; end: number }): void {
  const element = snapshot.element
  if (!element) return
  element.focus({ preventScroll: true })
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = selection?.start ?? snapshot.start ?? element.value.length
    const end = selection?.end ?? snapshot.end ?? start
    element.setSelectionRange(start, end)
    return
  }
  const range = snapshot.range
  if (range) {
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(range)
  }
}

function replaceSelection(snapshot: SelectionSnapshot, text: string): void {
  restoreSelection(snapshot)
  const element = snapshot.element
  if (!element) return
  if (document.execCommand('insertText', false, text)) return

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = snapshot.start ?? element.selectionStart ?? 0
    const end = snapshot.end ?? element.selectionEnd ?? start
    element.setRangeText(text, start, end, 'end')
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return
  }

  if (snapshot.range) {
    snapshot.range.deleteContents()
    const node = document.createTextNode(text)
    snapshot.range.insertNode(node)
    snapshot.range.setStartAfter(node)
    snapshot.range.collapse(true)
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(snapshot.range)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
}

function selectAll(snapshot: SelectionSnapshot): void {
  const element = snapshot.element
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus({ preventScroll: true })
    element.select()
    return
  }
  if (element?.isContentEditable) {
    restoreSelection(snapshot)
    document.execCommand('selectAll')
    return
  }
  const range = document.createRange()
  range.selectNodeContents(document.body)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

async function writeClipboard(text: string): Promise<void> {
  await copyPlainText(text)
}

async function readClipboard(): Promise<string> {
  return readPlainText()
}

export function TextContextMenu(): React.ReactElement | null {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const longPress = useRef<{ timer: number; pointerId: number; x: number; y: number; target: EventTarget | null } | null>(null)
  const suppressContextUntil = useRef(0)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const open = (x: number, y: number, target: EventTarget | null): void => {
      const position = clampContextMenuPosition(x, y, window.innerWidth, window.innerHeight)
      setMenu({ ...position, snapshot: snapshotSelection(target) })
    }

    const onContextMenu = (event: MouseEvent): void => {
      // Keep Android's selection handles and native copy menu for message text.
      if (window.Capacitor?.isNativePlatform?.() && event.target instanceof Element &&
        event.target.closest('[data-native-text-selection]') && !findEditableElement(event.target)) return
      if (Date.now() < suppressContextUntil.current) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      const { clientX, clientY } = event
      const target = event.target
      window.setTimeout(() => open(clientX, clientY, target), 0)
    }

    const clearLongPress = (): void => {
      if (!longPress.current) return
      window.clearTimeout(longPress.current.timer)
      longPress.current = null
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null)
      if (event.pointerType !== 'touch') return
      const editable = findEditableElement(event.target)
      if (!editable) return
      clearLongPress()
      longPress.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.target,
        timer: window.setTimeout(() => {
          const active = longPress.current
          if (!active || active.pointerId !== event.pointerId) return
          suppressContextUntil.current = Date.now() + 800
          navigator.vibrate?.(10)
          open(active.x, active.y, active.target)
          longPress.current = null
        }, 560)
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const active = longPress.current
      if (!active || active.pointerId !== event.pointerId) return
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12) clearLongPress()
    }

    const close = (): void => setMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerup', clearLongPress, { passive: true })
    document.addEventListener('pointercancel', clearLongPress, { passive: true })
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearLongPress()
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', clearLongPress)
      document.removeEventListener('pointercancel', clearLongPress)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (!menu) return null

  const hasSelection = menu.snapshot.selectedText.length > 0
  const editable = menu.snapshot.editable
  const action = async (operation: () => void | Promise<void>): Promise<void> => {
    try {
      await operation()
    } finally {
      setMenu(null)
    }
  }

  const itemClass = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-35'

  const menuElement = (
    <div
      ref={menuRef}
      role="menu"
      aria-label="文本快捷操作"
      className="pointer-events-auto fixed z-[2147483647] w-[172px] rounded-lg border border-line bg-panel p-1.5 shadow-2xl"
      style={{ left: menu.x, top: menu.y, isolation: 'isolate' }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" disabled={!hasSelection || !editable} className={itemClass} onClick={() => void action(async () => {
        await writeClipboard(menu.snapshot.selectedText)
        replaceSelection(menu.snapshot, '')
      })}>
        <Scissors size={14} /> 剪切
      </button>
      <button type="button" role="menuitem" disabled={!hasSelection} className={itemClass} onClick={() => void action(() => writeClipboard(menu.snapshot.selectedText))}>
        <Copy size={14} /> 复制
      </button>
      <button type="button" role="menuitem" disabled={!editable} className={itemClass} onClick={() => void action(async () => replaceSelection(menu.snapshot, await readClipboard()))}>
        <ClipboardPaste size={14} /> 粘贴
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={() => void action(() => selectAll(menu.snapshot))}>
        <TextSelect size={14} /> 全选
      </button>
    </div>
  )

  // Mount outside app/page stacking contexts so a context menu can never be
  // visually above a control while still losing pointer hit testing to it.
  return typeof document === 'undefined' ? menuElement : createPortal(menuElement, document.body)
}
